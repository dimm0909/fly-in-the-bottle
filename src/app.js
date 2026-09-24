import * as THREE from 'three';
import { createStudioEnvironment } from './env.js';
import { createJar } from './jar.js';
import { INNER_LAYER } from './fly.js';
import { BrainFly, restingDrive, ambientNoise } from './brainfly.js';
import { BrainLink } from './brainlink.js';
import { loadFlyAssets } from './flymodel.js';
import { JarMotion } from './motion.js';
import { Sound } from './audio.js';

const MAIN_LAYER = 0;
const GRAVITY = 14; // stylised: the jar is a tiny world, real g would make everything a blur

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

const DEBUG = new URLSearchParams(location.search).has('debug');
const log = (...args) => DEBUG && console.log('[w]', ...args);

// ---------------------------------------------------------------------------
// Renderer & scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
scene.environment = createStudioEnvironment(renderer);

const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
const LOOK_AT = new THREE.Vector3(0, 1.62, 0);
const pitch = THREE.MathUtils.degToRad(14);
camera.position.copy(LOOK_AT).add(new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(11.2));
camera.lookAt(LOOK_AT);

const key = new THREE.DirectionalLight(0xfff2e0, 2.2);
key.position.set(-3, 5, 4);
const fill = new THREE.HemisphereLight(0xdfeaff, 0x40342a, 0.5);
key.layers.enableAll();
fill.layers.enableAll();
scene.add(key, fill);

const jar = createJar();
// The connectome brain is optional: without it the fly falls back to its scripted behaviour.
const link = new BrainLink();
await link.init(restingDrive(), ambientNoise());
const fly = new BrainFly(await loadFlyAssets(), link);
jar.inner.add(fly.object);
scene.add(jar.root, jar.shadow);

// The fly is drawn to this target; the glass shader then looks it up through the wall.
const innerRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
jar.setInnerTexture(innerRT.texture);

const drawingSize = new THREE.Vector2();
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.getDrawingBufferSize(drawingSize);
  innerRT.setSize(drawingSize.x, drawingSize.y);
  jar.setResolution(drawingSize.x, drawingSize.y);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function render() {
  camera.layers.set(INNER_LAYER);
  renderer.setRenderTarget(innerRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  camera.layers.set(MAIN_LAYER);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

const sound = new Sound();
window.widget.getSettings().then((s) => sound.setEnabled(s.sound));
window.widget.onSettings(async (s) => {
  sound.setEnabled(s.sound);
  if (s.brain?.running && !link.ready) await link.init(restingDrive(), ambientNoise());
  else if (!s.brain?.running) link.stop();
});

fly.onBump = (impact) => sound.tick(clamp(impact / 4, 0.15, 1));
fly.onPoke = () => {
  sound.thud();
  sound.ting(0.5);
};

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

const motion = new JarMotion();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const flySphere = new THREE.Sphere();
const scratch = new THREE.Vector3();
const inverse = new THREE.Matrix4();

const TAP_MS = 350;
const TAP_SLOP = 6;

/** What is under the pointer? kind: 'fly' | 'lid' | 'glass' | null, plus the world-space hit point. */
function pick(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  camera.layers.set(MAIN_LAYER);

  const lid = raycaster.intersectObject(jar.lid, true)[0];
  const label = raycaster.intersectObject(jar.label)[0];
  const glass = raycaster.intersectObject(jar.glassFront)[0];
  if (!lid && !label && !glass) return null;

  const blocker = Math.min(lid?.distance ?? Infinity, label?.distance ?? Infinity);
  fly.object.getWorldPosition(flySphere.center);
  flySphere.radius = fly.hitRadius;
  const flyHit = raycaster.ray.intersectSphere(flySphere, scratch) ? raycaster.ray.origin.distanceTo(scratch) : Infinity;

  if (glass && flyHit < blocker) return { kind: 'fly', point: glass.point.clone() };
  if (lid && (!glass || lid.distance <= glass.distance)) return { kind: 'lid', point: lid.point.clone() };
  return { kind: 'glass', point: (label ?? glass ?? lid).point.clone() };
}

const toInnerLocal = (worldPoint) => jar.inner.worldToLocal(worldPoint.clone());

/** Which body part is under the pointer ray? (falls back to the thorax) */
function pokedPart() {
  raycaster.layers.set(INNER_LAYER);
  const hit = raycaster.intersectObject(fly.model.body, true)[0];
  raycaster.layers.set(MAIN_LAYER);
  if (!hit) return { name: 'c_thorax', x: 0 };
  let node = hit.object;
  while (node && !node.name) node = node.parent;
  return { name: node?.name ?? 'c_thorax', x: fly.object.worldToLocal(hit.point.clone()).x };
}

/** A shove at a world-space point on the jar: tilts it, spins it a little. */
function shove(worldPoint, strength = 1) {
  const p = jar.root.worldToLocal(worldPoint.clone());
  motion.kick(-(p.y / 3) * 1.5 * strength, 0);
  motion.yawVel += p.x * 1.4 * strength;
}

function pokeFly(hit) {
  inverse.copy(jar.inner.matrixWorld).invert();
  const dir = raycaster.ray.direction.clone().transformDirection(inverse);
  log('poke');
  fly.poke(dir);
  const part = pokedPart();
  fly.touch?.(part.name, part.x);
  jar.glint(hit.point);
  shove(hit.point, 0.5);
}

function tapGlass(hit) {
  log('tap');
  sound.ting(1);
  jar.glint(hit.point);
  shove(hit.point);
  fly.startle(toInnerLocal(hit.point), 2.4);
}

const pointer = { x: 0, y: 0, inside: false, prevDist: null };
const flyScreen = new THREE.Vector3();
const plane = new THREE.Plane();
const planePoint = new THREE.Vector3();
const camDir = new THREE.Vector3();

/**
 * The retina sees an object that approaches as an expanding blob: the rate of change of its
 * distance, relative to the distance, drives the looming neurons on that side of the fly.
 */
function updateThreat(dt) {
  const threat = fly.threat;
  threat.strength *= Math.exp(-dt / 0.25);
  if (!pointer.inside) {
    pointer.prevDist = null;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  fly.object.getWorldPosition(flyScreen);
  const wx = flyScreen.x, wy = flyScreen.y, wz = flyScreen.z;
  flyScreen.project(camera);
  const fx = ((flyScreen.x + 1) / 2) * rect.width;
  const fy = ((1 - flyScreen.y) / 2) * rect.height;
  const dist = Math.hypot(pointer.x - fx, pointer.y - fy);
  if (pointer.prevDist != null && dist < 280) {
    const closing = (pointer.prevDist - dist) / Math.max(dt, 1e-3);
    const strength = clamp((closing / (dist + 60)) * 0.5, 0, 1);
    if (strength > threat.strength) {
      threat.strength = strength;
      // which side of the fly is the object on? intersect the pointer ray with a plane through the fly
      ndc.set((pointer.x / rect.width) * 2 - 1, -(pointer.y / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      camera.getWorldDirection(camDir);
      plane.setFromNormalAndCoplanarPoint(camDir, scratch.set(wx, wy, wz));
      if (raycaster.ray.intersectPlane(plane, planePoint)) {
        threat.side = fly.object.worldToLocal(planePoint.clone()).x > 0 ? 'L' : 'R';
      }
    }
  }
  pointer.prevDist = dist;
}

let drag = null;
let pendingMove = null;
let hover = null;
const windowVel = { x: 0, y: 0, dx: 0, dy: 0 };

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.widget.showMenu();
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  sound.setEnabled(sound.enabled); // wake the AudioContext on first interaction if it was suspended
  const hit = pick(e.clientX, e.clientY);
  // Shift/Alt/Ctrl-drag moves the widget from anywhere; so does grabbing the lid.
  const moveMode = e.shiftKey || e.altKey || e.ctrlKey || hit?.kind === 'lid';
  if (!hit && !moveMode) return;

  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // synthetic events (tests) have no active pointer to capture
  }
  log('down', hit?.kind ?? 'none', moveMode ? 'move' : 'rotate');
  drag = {
    id: e.pointerId,
    mode: moveMode ? 'move' : 'rotate',
    hit,
    screenX: e.screenX,
    screenY: e.screenY,
    x: e.clientX,
    y: e.clientY,
    t0: e.timeStamp,
    tMove: e.timeStamp,
    moved: 0,
  };

  if (drag.mode === 'move') {
    window.widget.dragStart();
    Object.assign(windowVel, { x: 0, y: 0, dx: 0, dy: 0 });
    canvas.style.cursor = 'grabbing';
  } else {
    motion.grabbed = true;
    canvas.style.cursor = 'grabbing';
    if (hit.kind === 'fly') pokeFly(hit);
    else fly.startle(toInnerLocal(hit.point), 1.0);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId === drag.id) {
    if (drag.mode === 'move') {
      pendingMove = { dx: e.screenX - drag.screenX, dy: e.screenY - drag.screenY };
    } else {
      const ddx = e.clientX - drag.x;
      const ddy = e.clientY - drag.y;
      const dt = Math.max((e.timeStamp - drag.tMove) / 1000, 0.004);
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.tMove = e.timeStamp;
      drag.moved += Math.hypot(ddx, ddy);
      motion.yaw += ddx * 0.012;
      motion.yawVel = clamp(motion.yawVel * 0.5 + ((ddx * 0.012) / dt) * 0.5, -28, 28);
      motion.kick(ddy * 0.045, -ddx * 0.01);
    }
  } else {
    hover = { x: e.clientX, y: e.clientY };
  }
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
});
canvas.addEventListener('pointerleave', () => {
  pointer.inside = false;
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  canvas.style.cursor = 'default';
  if (d.mode === 'move') {
    // Letting go stops the window dead; the jar swings on.
    motion.jerk(-windowVel.x, -windowVel.y);
    window.widget.dragEnd();
  } else {
    motion.grabbed = false;
    // Holding still before releasing must not fling the jar.
    if (e.timeStamp - d.tMove > 90) motion.yawVel *= 0.15;
    if (d.hit.kind !== 'fly' && d.moved < TAP_SLOP && e.timeStamp - d.t0 < TAP_MS) tapGlass(d.hit);
  }
  hover = { x: e.clientX, y: e.clientY };
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function updateHoverCursor() {
  if (!hover || drag) return;
  const hit = pick(hover.x, hover.y);
  hover = null;
  canvas.style.cursor = !hit ? 'default' : hit.kind === 'fly' ? 'pointer' : 'grab';
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const gravity = new THREE.Vector3();
const qInv = new THREE.Quaternion();
const flyWorld = new THREE.Vector3();
// A desktop widget has no business rendering at 240 Hz, or at 60 while the fly just sits there.
const FRAME_MS_BUSY = 1000 / 60;
const FRAME_MS_IDLE = 1000 / 20;
let last = performance.now();
let busyUntil = 0;

function frame(now) {
  const interacting = drag || motion.shake > 0.03 || Math.abs(motion.yawVel) > 0.05 || Math.abs(motion.pitchVel) + Math.abs(motion.rollVel) > 0.05;
  if (interacting || fly.activity > 0.05) busyUntil = now + 400;
  if (now - last < (now < busyUntil ? FRAME_MS_BUSY : FRAME_MS_IDLE) - 1.5) return;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // Window being dragged: forward the position and let the jar feel the acceleration.
  if (drag?.mode === 'move' && pendingMove) {
    window.widget.dragMove(pendingMove.dx, pendingMove.dy);
    const vx = (pendingMove.dx - windowVel.dx) / dt;
    const vy = (pendingMove.dy - windowVel.dy) / dt;
    windowVel.dx = pendingMove.dx;
    windowVel.dy = pendingMove.dy;
    const sx = windowVel.x + (vx - windowVel.x) * 0.45;
    const sy = windowVel.y + (vy - windowVel.y) * 0.45;
    motion.jerk(sx - windowVel.x, sy - windowVel.y);
    windowVel.x = sx;
    windowVel.y = sy;
    pendingMove = null;
  }

  motion.update(dt);
  jar.root.rotation.set(motion.pitch, 0, motion.roll);
  jar.spin.rotation.y = motion.yaw;
  jar.shadow.position.set(-motion.roll * 0.6, 0.002, motion.pitch * 0.6);
  jar.root.updateMatrixWorld(true);

  // Gravity in the jar's tilted frame (matters while the fly is tumbling).
  qInv.copy(jar.root.quaternion).invert();
  gravity.set(0, -GRAVITY, 0).applyQuaternion(qInv);
  updateThreat(dt);
  fly.update(dt, { gravity, shake: motion.shake });
  jar.update(dt);

  fly.object.getWorldPosition(flyWorld);
  sound.update({
    buzz: fly.buzz,
    speed: fly.buzzSpeed,
    pan: flyWorld.x / 1.2,
    depth: clamp(fly.vel.z / 4, -1, 1),
  });

  updateHoverCursor();
  render();
}
renderer.setAnimationLoop(frame);

// Dev hook (enabled with ?debug=1) used by the screenshot script.
if (DEBUG) {
  window.__w = { THREE, jar, fly, link, motion, sound, camera, scene, renderer, pick, frame, resize };
}
