import * as THREE from 'three';
import { studioEnvGLSL } from './env.js';

// All dimensions are in scene units; the jar stands on y = 0 with its axis on y.
export const JAR = {
  R: 1.0, // outer radius of the body
  WALL: 0.075,
  BODY_TOP: 2.25, // where the straight wall ends and the shoulder starts
  SHOULDER_TOP: 2.8,
  NECK_R: 0.66,
  NECK_TOP: 3.0,
  FLOOR_Y: 0.13, // top of the thick glass base (inside)
  LID_Y: 3.12, // lid centre
  LID_H: 0.36,
  LID_R: 0.8,
};

const smooth = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(t, 0), 1));

/** Outer glass radius at height y (straight wall, S-curved shoulder, neck). */
export function outerRadiusAt(y) {
  if (y <= JAR.BODY_TOP) return JAR.R;
  if (y >= JAR.SHOULDER_TOP) return JAR.NECK_R;
  const t = (y - JAR.BODY_TOP) / (JAR.SHOULDER_TOP - JAR.BODY_TOP);
  return JAR.R - (JAR.R - JAR.NECK_R) * smooth(t);
}

export const innerRadiusAt = (y) => outerRadiusAt(y) - JAR.WALL;

/** Profile (radius, y) from the base centre up to the neck, offset inward by `inset`. */
function profile(inset, floorY, corner) {
  const V = (x, y) => new THREE.Vector2(x, y);
  const R = JAR.R - inset;
  const pts = [V(0, floorY), V(R * 0.5, floorY)];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * (Math.PI / 2);
    pts.push(V(R - corner + corner * Math.cos(a), floorY + corner + corner * Math.sin(a)));
  }
  pts.push(V(R, JAR.BODY_TOP));
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    const y = JAR.BODY_TOP + (i / steps) * (JAR.SHOULDER_TOP - JAR.BODY_TOP);
    pts.push(V(outerRadiusAt(y) - inset, y));
  }
  pts.push(V(JAR.NECK_R - inset, JAR.NECK_TOP));
  return pts;
}

// ---------------------------------------------------------------------------
// Glass
// ---------------------------------------------------------------------------

const glassVertex = /* glsl */ `
  varying vec3 vPosW;
  varying vec3 vNormalW;
  varying vec3 vNormalV;
  varying vec3 vPosV;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vPosV = mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const glassFragment = /* glsl */ `
  uniform sampler2D uInner;
  uniform vec2 uRes;
  uniform float uReflect;
  uniform float uBaseAlpha;
  uniform float uEdgeAlpha;
  uniform float uRefract;
  uniform vec3 uTint;
  uniform vec4 uGlint;
  varying vec3 vPosW;
  varying vec3 vNormalW;
  varying vec3 vNormalV;
  varying vec3 vPosV;

  ${studioEnvGLSL}

  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    float sgn = gl_FrontFacing ? 1.0 : -1.0;
    vec3 Nv = normalize(vNormalV) * sgn;
    vec3 Nw = normalize(vNormalW) * sgn;
    vec3 Vv = normalize(-vPosV);
    vec3 Vw = normalize(cameraPosition - vPosW);
    float edge = 1.0 - clamp(dot(Nv, Vv), 0.0, 1.0);

    // Mirror reflection of the studio, Schlick fresnel with glass F0.
    vec3 R = reflect(-Vw, Nw);
    float fres = 0.04 + 0.96 * pow(edge, 5.0);
    vec3 refl = studioEnv(R) * fres * uReflect;

    // Glint where the glass was tapped.
    vec3 dg = vPosW - uGlint.xyz;
    refl += vec3(1.0) * uGlint.w * exp(-dot(dg, dg) / 0.05);

    // The glass volume itself: faint tint that thickens towards the silhouette.
    float bodyA = uBaseAlpha + uEdgeAlpha * pow(edge, 2.0);
    vec3 bodyC = uTint * (0.6 - 0.4 * edge);
    vec3 P = bodyC * bodyA;
    float A = bodyA;

    #if COMPOSITE
      // Everything inside the jar was rendered to uInner (premultiplied, linear).
      // Look it up through the wall: bend by the surface normal, split RGB a bit.
      vec2 suv = gl_FragCoord.xy / uRes;
      vec2 off = -Nv.xy * uRefract * (0.25 + 2.2 * edge * edge);
      vec4 sR = texture2D(uInner, suv + off);
      vec4 sG = texture2D(uInner, suv + off * 1.07);
      vec4 sB = texture2D(uInner, suv + off * 1.14);
      vec3 innerC = vec3(sR.r, sG.g, sB.b);
      float innerA = (sR.a + sG.a + sB.a) / 3.0;
      float T = 1.0 - 0.18 * edge;
      P += innerC * T * (1.0 - A);
      A += innerA * T * (1.0 - A);
    #endif

    // Reflections are additive light; bump alpha so they show on a clear background.
    P += refl;
    A = clamp(A + max(refl.r, max(refl.g, refl.b)) * 0.9, 0.0, 1.0);

    vec3 c = clamp(P / max(A, 1e-4), 0.0, 1.0);
    gl_FragColor = vec4(toSRGB(c) * A, A);
  }
`;

function glassMaterial(shared, { side, composite, reflect, baseAlpha, edgeAlpha }) {
  return new THREE.ShaderMaterial({
    defines: { COMPOSITE: composite ? 1 : 0 },
    uniforms: {
      ...shared,
      uReflect: { value: reflect },
      uBaseAlpha: { value: baseAlpha },
      uEdgeAlpha: { value: edgeAlpha },
    },
    vertexShader: glassVertex,
    fragmentShader: glassFragment,
    side,
    transparent: true,
    depthWrite: false,
    // Premultiplied "over" compositing so the transparent desktop shows through.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------------------
// Lid, shadow
// ---------------------------------------------------------------------------

function canvasTexture(width, height, draw, { srgb = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function lidTopTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    const c = w / 2;
    const base = g.createRadialGradient(c * 0.8, c * 0.7, 10, c, c, c);
    base.addColorStop(0, '#e6c56d');
    base.addColorStop(1, '#b8923f');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // brushed rings
    g.globalAlpha = 0.16;
    for (let r = 6; r < c; r += 3) {
      g.strokeStyle = r % 6 ? '#ffffff' : '#7a5a1e';
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    // punched air holes
    const holes = [[0, 0]];
    for (let i = 0; i < 7; i++) holes.push([Math.cos((i / 7) * Math.PI * 2 + 0.3) * 0.5, Math.sin((i / 7) * Math.PI * 2 + 0.3) * 0.5]);
    for (const [hx, hy] of holes) {
      const x = c + hx * c * 0.95;
      const y = c + hy * c * 0.95;
      g.fillStyle = '#7a5a1e';
      g.beginPath();
      g.arc(x, y, 17, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0c0904';
      g.beginPath();
      g.arc(x, y, 13, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function shadowTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.32)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

function buildLid() {
  const lid = new THREE.Group();
  const h = JAR.LID_H / 2;
  const V = (x, y) => new THREE.Vector2(x, y);
  const pts = [
    V(0.001, -h), V(JAR.LID_R - 0.03, -h), V(JAR.LID_R - 0.004, -h + 0.02), V(JAR.LID_R, -h + 0.05),
    V(JAR.LID_R, h - 0.05), V(JAR.LID_R - 0.03, h - 0.01), V(JAR.LID_R - 0.08, h), V(JAR.LID_R - 0.13, h - 0.02),
    V(JAR.LID_R - 0.15, h - 0.035), V(0.001, h - 0.035),
  ];
  const sideGeo = new THREE.LatheGeometry(pts, 176);

  // Knurled rim: push the side wall out in ribs and tilt the normals to match,
  // so the ribs catch light (and reveal the jar's spin).
  const ribs = 44;
  const amp = 0.011;
  const pos = sideGeo.attributes.position;
  const nor = sideGeo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.abs(y) > h - 0.06 || Math.hypot(x, z) < JAR.LID_R - 0.02) continue;
    const phi = Math.atan2(x, z);
    const k = 1 + amp * Math.sin(ribs * phi);
    pos.setXYZ(i, x * k, y, z * k);
    const tilt = -amp * ribs * Math.cos(ribs * phi);
    const n = new THREE.Vector3(Math.sin(phi) + Math.cos(phi) * tilt, 0, Math.cos(phi) - Math.sin(phi) * tilt).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }

  const metal = new THREE.MeshStandardMaterial({ color: 0xd8b25c, metalness: 1, roughness: 0.34 });
  lid.add(new THREE.Mesh(sideGeo, metal));

  const topGeo = new THREE.CircleGeometry(JAR.LID_R - 0.15, 96);
  topGeo.rotateX(-Math.PI / 2);
  const top = new THREE.Mesh(
    topGeo,
    new THREE.MeshStandardMaterial({ map: lidTopTexture(), metalness: 1, roughness: 0.38, color: 0xffffff }),
  );
  top.position.y = h - 0.033;
  lid.add(top);

  lid.position.y = JAR.LID_Y;
  return lid;
}

// ---------------------------------------------------------------------------
// The jar
// ---------------------------------------------------------------------------

/**
 * Scene graph:
 *   root (tilt: pitch/roll, pivot on the base centre)
 *   ├─ spin (yaw) ── glass shells, lid
 *   └─ inner ─────── everything living inside the jar (the fly), tilts but does not spin
 */
export function createJar() {
  const root = new THREE.Group();
  const spin = new THREE.Group();
  const inner = new THREE.Group();
  root.add(spin, inner);

  const shared = {
    uInner: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uRefract: { value: 0.028 },
    uTint: { value: new THREE.Color(0.55, 0.82, 0.74) },
    uGlint: { value: new THREE.Vector4(0, 0, 0, 0) },
  };

  const outerGeo = new THREE.LatheGeometry(profile(0, 0, 0.14), 128);
  const innerGeo = new THREE.LatheGeometry(profile(JAR.WALL, JAR.FLOOR_Y, 0.1).reverse(), 128);

  // Far shells first, near shells last; only the outermost near shell composites the interior.
  const shells = [
    { geo: outerGeo, order: 1, opts: { side: THREE.BackSide, composite: false, reflect: 0.45, baseAlpha: 0.012, edgeAlpha: 0.5 } },
    { geo: innerGeo, order: 2, opts: { side: THREE.FrontSide, composite: false, reflect: 0.5, baseAlpha: 0.0, edgeAlpha: 0.22 } },
    { geo: innerGeo, order: 3, opts: { side: THREE.BackSide, composite: false, reflect: 0.5, baseAlpha: 0.0, edgeAlpha: 0.26 } },
    { geo: outerGeo, order: 4, opts: { side: THREE.FrontSide, composite: true, reflect: 1.0, baseAlpha: 0.015, edgeAlpha: 0.55 } },
  ];
  let glassFront = null;
  for (const { geo, order, opts } of shells) {
    const mesh = new THREE.Mesh(geo, glassMaterial(shared, opts));
    mesh.renderOrder = order;
    spin.add(mesh);
    if (order === 4) glassFront = mesh;
  }

  const lid = buildLid();
  spin.add(lid);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false }),
  );
  shadow.position.y = 0.002;

  return {
    root,
    spin,
    inner,
    lid,
    glassFront, // also the raycast target for "is the pointer on the jar"
    shadow,
    setInnerTexture(texture) {
      shared.uInner.value = texture;
    },
    setResolution(w, h) {
      shared.uRes.value.set(w, h);
    },
    /** Flash a soft highlight where the glass was tapped (world-space point). */
    glint(point) {
      shared.uGlint.value.set(point.x, point.y, point.z, 1);
    },
    update(dt) {
      shared.uGlint.value.w *= Math.exp(-dt * 7);
    },
  };
}
