import * as THREE from 'three';

// Anatomical fly: FlyBody (TuragaLab/flybody, Apache-2.0; Vaxenburg et al., Nature 2025), a female
// Drosophila built from confocal microscopy (67 manually segmented body components): facetted
// compound eyes, ocelli, wing veins and membrane, abdominal segments with lower plates, antennae,
// bristled proboscis, and legs of coxa, femur, tibia, four tarsal segments and a claw.
// tools/build_fly_flybody.py turns it into assets/fly/flybody/{rig.json,meshes.bin}.
//
// The source frame is x forward, y left, z up in millimetres; ours is x left, y up, z forward
// in jar units. The bodies keep FlyBody's rest pose, which is a standing pose with spread wings;
// legs are re-posed by IK every frame, wings, head, abdomen and proboscis by their own rules.

/** Layer the fly lives on: it is rendered to an offscreen target and seen through the glass. */
export const INNER_LAYER = 1;

export const MM = 0.17; // jar units per millimetre of real fly
const GROUND_MM = 1.319; // feet stand this far below the thorax origin (rig.json constants.groundMM)
/** Height of the thorax origin above a surface while standing, in jar units. */
export const BODY_H = GROUND_MM * MM;

const { Vector3: V3, Quaternion } = THREE;

const toV = (p) => new V3(p[1], p[2], p[0]);
const toQ = ([w, x, y, z]) => new Quaternion(y, z, x, w);

const AX_X = new V3(1, 0, 0);
const AX_Y = new V3(0, 1, 0);
const AX_Z = new V3(0, 0, 1);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadFlyAssets() {
  const read = async (rel) => {
    const bytes = await window.widget.readAsset(rel);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };
  const rig = JSON.parse(new TextDecoder().decode(await read('fly/flybody/rig.json')));
  const blob = await read('fly/flybody/meshes.bin');
  return { rig, blob };
}

// ---------------------------------------------------------------------------
// Geometry & materials
// ---------------------------------------------------------------------------

/** One mesh of the blob -> BufferGeometry in jar units, source frame permuted into ours. */
function geometryOf(m, blob) {
  const n = m.vertexCount;
  const src = new Float32Array(blob, m.pos, n * 3);
  const nsrc = new Int8Array(blob, m.nor, n * 3);
  const pos = new Float32Array(n * 3);
  const nor = new Int8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = src[i * 3];
    const y = src[i * 3 + 1];
    const z = src[i * 3 + 2];
    pos[i * 3] = y * MM;
    pos[i * 3 + 1] = z * MM;
    pos[i * 3 + 2] = x * MM;
    nor[i * 3] = nsrc[i * 3 + 1];
    nor[i * 3 + 1] = nsrc[i * 3 + 2];
    nor[i * 3 + 2] = nsrc[i * 3];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(blob, m.idx, m.indexCount), 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

function makeMaterials(defs) {
  const rgba = (name) => defs[name]?.rgba ?? [0.5, 0.5, 0.5, 1];
  const cuticle = (name, extra = {}) => {
    const [r, g, b] = rgba(name);
    return new THREE.MeshPhysicalMaterial({ color: srgb(r, g, b), roughness: 0.5, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4, ...extra });
  };
  const membrane = (opacity) => {
    const [r, g, b] = rgba('membrane');
    return new THREE.MeshPhysicalMaterial({
      color: srgb(r, g, b),
      transparent: true,
      opacity,
      roughness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      iridescence: 1,
      iridescenceIOR: 1.5,
    });
  };
  const black = { color: srgb(0.035, 0.03, 0.03), roughness: 0.4, clearcoat: 0.4 };
  return {
    byName: {
      body: cuticle('body', { color: srgb(0.62, 0.40, 0.17) }), // FlyBody's own orange, nudged towards yellow-brown
      lower: cuticle('lower'),
      brown: cuticle('brown', { roughness: 0.45 }),
      black: cuticle('black', black),
      'bristle-brown': cuticle('bristle-brown', black),
      ocelli: cuticle('ocelli', { roughness: 0.15, clearcoat: 1 }),
      red: cuticle('red', { roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, emissive: srgb(0.16, 0.01, 0.0) }),
      membrane: membrane(0.4),
    },
    ghost: membrane(0.1),
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const GROUP = { f: 0, m: 1, h: 0 }; // tripod gait: (L1, R2, L3) vs (R1, L2, R3)
const FOLD_YAW = 1.6; // wing folded along the abdomen: this far round the vertical axis from spread
const FOLD_ROLL = -0.05;

const _v = new V3();
const _q = new Quaternion();
const _q2 = new Quaternion();

function worldQuat(node) {
  return node.getWorldQuaternion(new Quaternion());
}

export function buildFlyModel({ rig, blob }) {
  const materials = makeMaterials(rig.materials);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const geometries = rig.meshes.map((m) => geometryOf(m, blob));

  // --- the body tree, in FlyBody's rest pose
  const nodes = {};
  const list = rig.bodies.map((b) => {
    const node = new THREE.Group();
    node.name = b.name;
    node.position.copy(toV(b.pos)).multiplyScalar(MM);
    node.quaternion.copy(toQ(b.quat));
    for (const mi of b.meshes) {
      const m = rig.meshes[mi];
      node.add(new THREE.Mesh(geometries[mi], materials.byName[m.material] ?? materials.byName.body));
    }
    nodes[b.name] = node;
    return node;
  });
  rig.bodies.forEach((b, i) => (b.parent >= 0 ? list[b.parent] : body).add(list[i]));
  const thorax = nodes.c_thorax;
  root.updateMatrixWorld(true);

  // --- wings: the real wing plus two fainter membrane copies fanned around it (motion blur)
  const wings = [];
  for (const [s, side] of [['l', 1], ['r', -1]]) {
    const main = nodes[`${s}_wing`];
    const spread = main.quaternion.clone();
    const fold = new Quaternion().setFromAxisAngle(AX_Y, side * FOLD_YAW).multiply(new Quaternion().setFromAxisAngle(AX_Z, side * FOLD_ROLL));
    wings.push({ node: main, side, ghost: 0, spread, fold });
    const membrane = rig.bodies.find((b) => b.name === `${s}_wing`).meshes.find((mi) => rig.meshes[mi].material === 'membrane');
    for (const ghost of [0.45, -0.45]) {
      const node = new THREE.Group();
      node.position.copy(main.position);
      node.quaternion.copy(spread);
      node.add(new THREE.Mesh(geometries[membrane], materials.ghost));
      thorax.add(node);
      wings.push({ node, side, ghost, spread, fold });
    }
  }
  const halteres = [['l', 1], ['r', -1]].map(([s, side]) => ({ node: nodes[`${s}_haltere`], side, rest: nodes[`${s}_haltere`].quaternion.clone() }));

  // --- legs. Coxa+femur and tibia+tarsi are each treated as one rigid bone for IK, in FlyBody's
  //     rest pose: the upper bone runs from the hip to the knee (tibia origin), the lower bone
  //     from the knee to the tip of the claw.
  const legs = [];
  for (const [s, side] of [['l', 1], ['r', -1]]) {
    for (const kind of ['f', 'm', 'h']) {
      const p = `${s}${kind}_`;
      const coxa = nodes[`${p}coxa`];
      const femur = nodes[`${p}femur`];
      const tibia = nodes[`${p}tibia`];
      const hip = coxa.getWorldPosition(new V3());
      const knee = tibia.getWorldPosition(new V3());
      // the claw tip: the vertex of the last tarsal segments farthest from the knee
      const foot = knee.clone();
      let far = 0;
      for (const name of [`${p}tarsus4`, `${p}claw`]) {
        const node = nodes[name];
        for (const mesh of node.children) {
          if (!mesh.isMesh) continue; // child bodies live in the same list
          const a = mesh.geometry.attributes.position;
          for (let i = 0; i < a.count; i++) {
            _v.fromBufferAttribute(a, i).applyMatrix4(node.matrixWorld);
            const d = _v.distanceToSquared(knee);
            if (d > far) {
              far = d;
              foot.copy(_v);
            }
          }
        }
      }
      legs.push({
        side,
        idx: ['f', 'm', 'h'].indexOf(kind),
        group: (GROUP[kind] + (side > 0 ? 0 : 1)) % 2,
        coxa,
        tibia,
        hip,
        a: hip.distanceTo(knee),
        b: knee.distanceTo(foot),
        upperDir0: knee.clone().sub(hip).normalize(),
        lowerDir0: foot.clone().sub(knee).normalize(),
        coxaRest: coxa.quaternion.clone(),
        femurRest: femur.quaternion.clone(),
        tibiaRestWorld: worldQuat(tibia),
        home: foot.clone(), // FlyBody's rest pose is a standing pose: the claws are on the ground
        tuck: new V3(foot.x * 0.5, foot.y * 0.55, foot.z * 0.75), // in flight the legs hang tucked under the body
        twitch: new V3(), // brain-driven offset of the foot target, body space
        ext: 0, // foot position along the body relative to its standing spot, in strides (+ forward); set by Fly.poseLegs
        extV: 0, // and its speed, strides per second
        planted: new V3(),
        stepFrom: new V3(),
        stepTo: new V3(),
        stepT: 1,
        foot: new V3(),
      });
    }
  }

  // --- head, abdomen and proboscis rotate about their own joints, about the fly's axes
  const head = nodes.c_head;
  const headRest = head.quaternion.clone();
  const headRestWorld = worldQuat(head);
  const rostrum = nodes.c_rostrum;
  const haustellum = nodes.c_haustellum;
  const rostrumRest = rostrum.quaternion.clone();
  const haustellumRest = haustellum.quaternion.clone();
  const rostrumAxis = AX_X.clone().applyQuaternion(headRestWorld.clone().invert());
  const haustellumAxis = AX_X.clone().applyQuaternion(worldQuat(rostrum).invert());

  const segments = [2, 3, 4, 5, 6, 7].map((i) => {
    const node = nodes[`c_abdomen${i}`];
    return { node, rest: node.quaternion.clone(), axis: AX_X.clone().applyQuaternion(worldQuat(node.parent).invert()) };
  });

  // where the front feet go while grooming: just in front of the head, a little below its centre
  const headBox = new THREE.Box3();
  for (const mesh of head.children) if (mesh.isMesh) headBox.union(mesh.geometry.boundingBox);
  headBox.applyMatrix4(head.matrixWorld);
  const groom = new V3(0, headBox.min.y + (headBox.max.y - headBox.min.y) * 0.3, headBox.max.z + 0.03);

  root.traverse((o) => o.layers.set(INNER_LAYER));

  return {
    root,
    body,
    head,
    thorax,
    nodes,
    wings,
    halteres,
    legs,
    groom,
    /** Neck: nod (pitch) and turn (yaw), both in the thorax frame. */
    setHead(pitch, yaw) {
      head.quaternion.copy(_q.setFromAxisAngle(AX_Y, yaw)).multiply(_q2.setFromAxisAngle(AX_X, pitch)).multiply(headRest);
    },
    /** Abdomen curl: total bend in radians over its six joints (negative = tail down and forward). */
    bendAbdomen(total) {
      const step = total / segments.length;
      for (const s of segments) s.node.quaternion.copy(_q.setFromAxisAngle(s.axis, step)).multiply(s.rest);
    },
    /** Proboscis: 0 folded, 1 fully extended. */
    setProboscis(k) {
      rostrum.quaternion.copy(_q.setFromAxisAngle(rostrumAxis, -0.9 * k)).multiply(rostrumRest);
      haustellum.quaternion.copy(_q.setFromAxisAngle(haustellumAxis, -0.5 * k)).multiply(haustellumRest);
    },
  };
}

// ---------------------------------------------------------------------------
// Leg IK
// ---------------------------------------------------------------------------

const _d = new V3();
const _pole = new V3();
const _perp = new V3();
const _knee = new V3();
const _foot = new V3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _qf = new Quaternion();

/**
 * Two-bone IK in body space: hip -> knee -> claw tip with the leg's own bone lengths. A foot out
 * of reach is pulled in. Each bone is turned from its rest direction to the new one with the
 * smallest rotation; writes the coxa and tibia orientations.
 */
export function solveLeg(leg, target) {
  const { a, b } = leg;
  _d.subVectors(target, leg.hip);
  let len = _d.length();
  const reach = (a + b) * 0.985;
  if (len > reach) {
    _d.multiplyScalar(reach / len);
    len = reach;
  }
  len = Math.max(len, Math.abs(a - b) + 0.01);
  _d.normalize();
  _foot.copy(leg.hip).addScaledVector(_d, len);

  const x = (len * len + a * a - b * b) / (2 * len);
  const h = Math.sqrt(Math.max(a * a - x * x, 0));
  _pole.set(leg.side * 0.6, 1, leg.idx === 0 ? 0.4 : leg.idx === 2 ? -0.5 : 0); // knees bend up and outward
  _perp.copy(_pole).addScaledVector(_d, -_pole.dot(_d)).normalize();
  _knee.copy(leg.hip).addScaledVector(_d, x).addScaledVector(_perp, h);

  // upper bone (coxa and femur move as one): the thorax frame is the coxa's parent, so local = world
  _d.subVectors(_knee, leg.hip).normalize();
  _qa.setFromUnitVectors(leg.upperDir0, _d).multiply(leg.coxaRest);
  leg.coxa.quaternion.copy(_qa);
  // lower bone (tibia and tarsi): expressed relative to the femur's new world orientation
  _d.subVectors(_foot, _knee).normalize();
  _qb.setFromUnitVectors(leg.lowerDir0, _d).multiply(leg.tibiaRestWorld);
  _qf.copy(_qa).multiply(leg.femurRest).invert();
  leg.tibia.quaternion.copy(_qf).multiply(_qb);
  leg.foot.copy(_foot);
}
