import * as THREE from 'three';

// A procedural "photo studio": soft sky, a mullioned window front-left, a tall
// strip light on the right, a small overhead panel and a warm rim light behind.
// The same GLSL is used by the glass shader (analytic reflections) and baked
// into a PMREM texture for the standard materials (lid, fly), so every
// surface reflects the same room.
export const studioEnvGLSL = /* glsl */ `
float rectMask(vec2 p, vec2 c, vec2 h, float s) {
  vec2 q = abs(p - c) - h;
  return 1.0 - smoothstep(-s, s, max(q.x, q.y));
}

vec3 studioEnv(vec3 d) {
  d = normalize(d);
  float az = atan(d.x, d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 p = vec2(az, el);

  vec3 sky = mix(vec3(0.40, 0.48, 0.60), vec3(0.92, 0.95, 1.0), smoothstep(-0.1, 0.9, d.y));
  vec3 ground = vec3(0.12, 0.11, 0.10);
  vec3 col = mix(ground, sky, smoothstep(-0.25, 0.12, el)) * 0.5;

  // Window with mullions (front-left of the camera).
  float win = rectMask(p, vec2(-0.85, 0.34), vec2(0.30, 0.50), 0.025);
  float mullionV = smoothstep(0.010, 0.020, abs(fract((az + 0.85) / 0.20 + 0.5) - 0.5) * 0.20);
  float mullionH = smoothstep(0.010, 0.020, abs(el - 0.34));
  col += vec3(16.0, 15.6, 14.6) * win * mullionV * mullionH;

  // Tall strip light (right).
  col += vec3(7.0, 8.2, 10.0) * rectMask(p, vec2(1.15, 0.15), vec2(0.06, 0.75), 0.03);

  // Overhead panel.
  col += vec3(6.0) * rectMask(p, vec2(0.2, 1.25), vec2(0.5, 0.14), 0.05);

  // Warm rim light from behind-left.
  col += vec3(5.0, 3.4, 2.0) * rectMask(p, vec2(2.7, 0.2), vec2(0.14, 0.6), 0.05);

  return col;
}
`;

/** Bake the studio into a PMREM environment for MeshStandard/Physical materials. */
export function createStudioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${studioEnvGLSL}
      void main() { gl_FragColor = vec4(studioEnv(vDir), 1.0); }
    `,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), material));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  material.dispose();
  return target.texture;
}
