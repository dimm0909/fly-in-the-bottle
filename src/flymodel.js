import * as THREE from 'three';
import { STLLoader } from '../node_modules/three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

// Anatomical fly: the 39 body-part meshes of NeuroMechFly v2 (micro-CT of a real Drosophila,
// NeLy-EPFL/flygym, Apache-2.0), assembled from assets/fly/rig.json.
//
// The source frame is x forward, y left, z up in millimetres; ours is x left, y up, z forward
// in jar units. Bodies are placed exactly as in the rig; legs are re-posed by IK every frame.

/** Layer the fly lives on: it is rendered to an offscreen target and seen through the glass. */
export const INNER_LAYER = 1;

export const MM = 0.2; // jar units per millimetre of real fly
const GROUND_MM = 1.0; // how far below the thorax origin the feet stand
const THORAX_CENTER_Z_MM = -0.096;
/** Height of the body centre above a surface while standing, in jar units. */
export const BODY_H = (GROUND_MM + THORAX_CENTER_Z_MM) * MM;

const { Vector3: V3, Quaternion, Matrix4 } = THREE;
const DOWN = new V3(0, -1, 0);

const toV = (p) => new V3(p[1], p[2], p[0]);
const toQ = ([w, x, y, z]) => new Quaternion(y, z, x, w);

// rows: ours.x = src.y, ours.y = src.z, ours.z = src.x
const PERMUTE = new Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
const REFLECT_Y = new Matrix4().makeScale(1, -1, 1);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadFlyAssets() {
  const read = async (rel) => {
    const bytes = await window.widget.readAsset(rel);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };
  const rig = JSON.parse(new TextDecoder().decode(await read('fly/rig.json')));
  const loader = new STLLoader();
  const names = [...new Set(Object.values(rig.bodies).map((b) => b.mesh))];
  const geos = {};
  await Promise.all(
    names.map(async (name) => {
      geos[name] = loader.parse(await read(`fly/meshes/${name}.stl`));
    }),
  );
  return { rig, geos };
}

// ---------------------------------------------------------------------------
// Geometry & materials
// ---------------------------------------------------------------------------

/** STL (metres, source frame) -> smooth-shaded geometry in jar units, optionally mirrored. */
function prepareGeometry(source, mirror) {
  const g = source.clone();
  g.deleteAttribute('normal');
  const m = new Matrix4().makeScale(1000 * MM, 1000 * MM, 1000 * MM).multiply(PERMUTE);
  if (mirror) m.multiply(REFLECT_Y);
  g.applyMatrix4(m);
  const merged = mergeVertices(g, 1e-6);
  if (mirror) {
    // a reflection flips the winding
    const index = merged.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const t = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = t;
    }
  }
  merged.computeVertexNormals();
  return merged;
}

const TAN = new THREE.Color().setRGB(0.5, 0.36, 0.2, THREE.SRGBColorSpace);
const DARK = new THREE.Color().setRGB(0.17, 0.11, 0.07, THREE.SRGBColorSpace);
const PALE = new THREE.Color().setRGB(0.66, 0.58, 0.44, THREE.SRGBColorSpace);
const LEG = new THREE.Color().setRGB(0.42, 0.3, 0.17, THREE.SRGBColorSpace);
const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Bake vertex colours: tan cuticle with dark abdominal bands and thoracic stripes. */
function paint(geometry, name) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    c.copy(TAN);
    if (/^c_abdomen[3-6]$/.test(name)) {
      // dark tergite band on the posterior part of each segment (z is the body axis)
      const t = (z - bb.min.z) / (bb.max.z - bb.min.z); // 0 = posterior
      c.lerp(DARK, 0.92 * (1 - smoothstep(0.28, 0.5, t)) * smoothstep(-0.05, 0.05, nor.getY(i) + 0.6));
    } else if (name === 'c_abdomen12') {
      c.lerp(DARK, 0.3 * (1 - smoothstep(0.0, 0.3, (z - bb.min.z) / (bb.max.z - bb.min.z))));
    } else if (name === 'c_thorax') {
      // dorsal stripes
      const stripe = Math.max(1 - smoothstep(0.012, 0.03, Math.abs(x)), 1 - smoothstep(0.012, 0.03, Math.abs(Math.abs(x) - 0.09)));
      c.lerp(DARK, 0.75 * stripe * smoothstep(0.2, 0.7, nor.getY(i)));
    } else if (/_(rostrum|haustellum)$/.test(name)) {
      c.copy(PALE);
    } else if (/_(coxa|trochanterfemur|tibia)$/.test(name)) {
      c.copy(LEG);
    } else if (/_tarsus\d$/.test(name)) {
      c.copy(LEG).lerp(DARK, 0.55);
    } else if (/_(arista|funiculus)$/.test(name)) {
      c.copy(DARK);
    } else if (/_haltere$/.test(name)) {
      c.copy(PALE);
    }
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function makeMaterials() {
  const cuticle = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
  });
  const eye = new THREE.MeshPhysicalMaterial({
    color: 0x9b1a10,
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    emissive: 0x2a0402,
    flatShading: true, // the facets of a compound eye
  });
  const wing = (opacity) =>
    new THREE.MeshPhysicalMaterial({
      color: 0xe8eef2,
      transparent: true,
      opacity,
      roughness: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      iridescence: 1,
      iridescenceIOR: 1.5,
    });
  return { cuticle, eye, wingMain: wing(0.36), wingGhost: wing(0.1) };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

// Standing and flying foot targets in the thorax frame (source frame, mm).
const STANCE = { f: [0.55, 1.25, -GROUND_MM], m: [-0.55, 2.0, -GROUND_MM], h: [-1.65, 1.6, -GROUND_MM] };
const TUCK = { f: [0.4, 0.55, -0.75], m: [-0.5, 0.75, -0.95], h: [-1.5, 0.6, -1.0] };
const GROUP = { f: 0, m: 1, h: 0 }; // tripod gait: (L1, R2, L3) vs (R1, L2, R3)

export function buildFlyModel({ rig, geos }) {
  const materials = makeMaterials();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const geometry = {};
  const geometryFor = (bodySpec, name) => {
    const key = `${bodySpec.mesh}${bodySpec.mirror ? ':m' : ''}`;
    if (!geometry[key]) {
      geometry[key] = prepareGeometry(geos[bodySpec.mesh], bodySpec.mirror);
      paint(geometry[key], bodySpec.mesh);
    }
    return geometry[key];
  };

  const nodes = {};
  const build = (name) => {
    if (nodes[name]) return nodes[name];
    const spec = rig.bodies[name];
    const node = new THREE.Group();
    node.name = name;
    node.position.copy(toV(spec.pos)).multiplyScalar(MM);
    node.quaternion.copy(toQ(spec.quat));
    const isEye = /_eye$/.test(name);
    const isWing = /_wing$/.test(name);
    const mesh = new THREE.Mesh(geometryFor(spec, name), isEye ? materials.eye : isWing ? materials.wingMain : materials.cuticle);
    node.add(mesh);
    nodes[name] = node;
    (spec.parent ? build(spec.parent) : body).add(node);
    return node;
  };
  for (const name of Object.keys(rig.bodies)) build(name);

  // Put the thorax's centre of volume at the model origin.
  const thorax = nodes.c_thorax;
  thorax.position.set(0, 0, 0);
  const box = new THREE.Box3().setFromBufferAttribute(geometry.c_thorax.attributes.position);
  thorax.position.copy(box.getCenter(new V3())).negate();

  // --- Wings: the real wing plus two fainter copies fanned around it to fake motion blur.
  const wings = [];
  for (const [s, side] of [['l', 1], ['r', -1]]) {
    const main = nodes[`${s}_wing`];
    const rest = main.quaternion.clone();
    wings.push({ node: main, side, ghost: 0, rest });
    for (const ghost of [0.45, -0.45]) {
      const node = new THREE.Group();
      node.position.copy(main.position);
      node.quaternion.copy(rest);
      node.add(new THREE.Mesh(geometry[`l_wing${side < 0 ? ':m' : ''}`], materials.wingGhost));
      thorax.add(node);
      wings.push({ node, side, ghost, rest });
    }
  }
  const halteres = [['l', 1], ['r', -1]].map(([s, side]) => ({ node: nodes[`${s}_haltere`], side, rest: nodes[`${s}_haltere`].quaternion.clone() }));

  // --- Legs: coxa+femur and tibia+tarsus are each treated as one straight bone for IK.
  const legs = [];
  for (const [s, side] of [['l', 1], ['r', -1]]) {
    for (const kind of ['f', 'm', 'h']) {
      const p = `${s}${kind}_`;
      const coxa = nodes[`${p}coxa`];
      const femur = nodes[`${p}trochanterfemur`];
      const tibia = nodes[`${p}tibia`];
      const tarsi = [1, 2, 3, 4, 5].map((i) => nodes[`${p}tarsus${i}`]);

      const kneeOffset = femur.position.clone().add(tibia.position);
      const footOffset = new V3();
      for (const t of tarsi) footOffset.add(t.position);
      footOffset.y -= 0.117 * MM; // the claws beyond tarsus5's origin

      const sideSign = side;
      const inThorax = (mm) => toV([mm[0], mm[1] * sideSign, mm[2]]).multiplyScalar(MM).add(thorax.position);
      legs.push({
        side,
        idx: ['f', 'm', 'h'].indexOf(kind),
        group: (GROUP[kind] + (side > 0 ? 0 : 1)) % 2,
        coxa,
        tibia,
        hip: coxa.position.clone().add(thorax.position),
        a: kneeOffset.length(),
        b: footOffset.length(),
        kneeDir0: kneeOffset.clone().normalize(),
        footDir0: footOffset.clone().normalize(),
        home: inThorax(STANCE[kind]),
        tuck: inThorax(TUCK[kind]),
        twitch: new V3(), // brain-driven offset of the foot target, body space
        planted: new V3(),
        stepFrom: new V3(),
        stepTo: new V3(),
        stepT: 1,
        foot: new V3(),
      });
    }
  }

  root.traverse((o) => o.layers.set(INNER_LAYER));
  return { root, body, head: nodes.c_head, thorax, nodes, wings, halteres, legs };
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

/**
 * Two-bone IK in body space: hip -> knee -> foot with the leg's own bone lengths.
 * A foot out of reach is pulled in. Writes the coxa and tibia orientations.
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

  // upper bone: coxa+femur point from the hip to the knee
  _d.subVectors(_knee, leg.hip).normalize();
  _qa.setFromUnitVectors(leg.kneeDir0, _d);
  leg.coxa.quaternion.copy(_qa);
  // lower bone: tibia+tarsi point from the knee to the foot (tibia is parented to the femur)
  _d.subVectors(_foot, _knee).normalize();
  _qb.setFromUnitVectors(leg.footDir0, _d);
  leg.tibia.quaternion.copy(_qa).invert().multiply(_qb);
  leg.foot.copy(_foot);
}
