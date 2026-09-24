import * as THREE from 'three';
import { JAR, innerRadiusAt } from './jar.js';
import { INNER_LAYER, BODY_H, buildFlyModel, solveLeg } from './flymodel.js';

export { INNER_LAYER };

const { Vector3: V3, Quaternion } = THREE;
const TAU = Math.PI * 2;
const UP = new V3(0, 1, 0);
const AX_Y = new V3(0, 1, 0);
const AX_Z = new V3(0, 0, 1);

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// ---------------------------------------------------------------------------
// Geometry of the flight volume
// ---------------------------------------------------------------------------

const WALL_CLEAR = 0.3; // how close the body centre may get to the glass while flying
const FLOOR_REST = JAR.FLOOR_Y + BODY_H; // body centre height when standing on the floor
const Y_MIN = JAR.FLOOR_Y + BODY_H * 0.65;
const Y_MAX = 2.5;

const maxRadius = (y, clearance = WALL_CLEAR) => Math.max(0.15, innerRadiusAt(Math.min(y, 2.9)) - clearance);

const _goal = new V3();
const _qy = new Quaternion();
const _qz = new Quaternion();
const _qf = new Quaternion();
const IDENTITY = new Quaternion();

// ---------------------------------------------------------------------------
// The fly
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new Quaternion();
const _qi = new Quaternion();
const _a = new V3();
const _b = new V3();
const _c = new V3();

/** Orientation with forward = `fwd` and up as close to `up` as possible. */
function basisQuat(out, fwd, up) {
  _a.crossVectors(up, fwd);
  if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0).cross(fwd);
  _a.normalize();
  _b.crossVectors(fwd, _a);
  _m.makeBasis(_a, _b, _c.copy(fwd).normalize());
  return out.setFromRotationMatrix(_m);
}

const randomUnit = (out = new V3()) => {
  out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
  if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
  return out.normalize();
};

export class Fly {
  constructor(assets) {
    this.model = buildFlyModel(assets);
    this.object = this.model.root;
    this.hitRadius = 0.34;

    this.pos = new V3(0.15, 1.5, 0.2);
    this.vel = new V3(0.6, 0.2, -0.3);
    this.quat = new Quaternion();
    this.heading = new V3(0, 0, 1);
    this.omega = new V3();
    this.lastVel = new V3();
    this.bank = 0;

    this.state = 'fly';
    this.stateT = 0;
    this.time = 0;

    this.target = new V3();
    this.retarget = 0.4;
    this.cruise = 1.4;
    this.nervous = 0;
    this.fearOrigin = new V3();
    this.scaredT = 0;

    this.perchPoint = new V3();
    this.perchN = new V3(0, 1, 0);
    this.perchFwd = new V3(0, 0, 1);
    this.perchKind = 'floor';
    this.perchLeft = 0;
    this.perchMode = 'idle';
    this.perchT = 0;
    this.walkTarget = new V3();
    this.turnLeft = 0;
    this.turnRate = 0;
    this.perchBlend = 0;
    this.cleanBlend = 0;

    this.tumbleMin = 0;
    this.dizzyT = 0;
    this.upsideDown = false;

    this.wingAmp = 1;
    this.wingFold = 0;
    this.flapPhase = 0;

    // Read by the audio engine.
    this.buzz = 0;
    this.buzzSpeed = 0;

    // Callbacks: (impactSpeed) / ()
    this.onBump = null;
    this.onLand = null;
    this.onPoke = null;

    this.object.position.copy(this.pos);
  }

  get speed() {
    return this.vel.length();
  }

  /** 0 when the fly is at rest (the app then renders at a low frame rate), larger when it moves. */
  get activity() {
    return this.state === 'perch' && (this.perchMode === 'idle' || this.perchMode === 'turn') ? 0 : 1;
  }

  // ----- external stimuli ---------------------------------------------------

  /** Direct hit on the fly: it is knocked away along `dir` and tumbles. */
  poke(dir) {
    this.state = 'tumble';
    this.stateT = 0;
    this.tumbleMin = 0.55;
    this.vel.copy(dir).normalize().multiplyScalar(2.8).add(randomUnit().multiplyScalar(0.8));
    this.omega.copy(randomUnit()).multiplyScalar(rand(9, 16));
    this.perchBlend = Math.min(this.perchBlend, 0.6);
    this.onPoke?.();
  }

  /** Something knocked on the glass at `origin`; nearby flies bolt. */
  startle(origin, radius = 1.2) {
    if (!['fly', 'approach', 'perch'].includes(this.state)) return;
    if (this.pos.distanceTo(origin) > radius) return;
    const wasPerched = this.state === 'perch';
    this.state = 'scared';
    this.stateT = 0;
    this.scaredT = rand(1.1, 2.2);
    this.fearOrigin.copy(origin);
    this.retarget = 0;
    if (wasPerched) this.vel.copy(this.perchN).multiplyScalar(1.2);
  }

  // ----- simulation ---------------------------------------------------------

  /**
   * @param dt seconds
   * @param env { gravity: V3 (jar-local, units/s²), shake: number (0 = calm) }
   */
  update(dt, env) {
    this.stateT += dt;
    this.time += dt;
    this.nervous = Math.max(0, this.nervous - dt);

    if (env.shake > 1 && this.state !== 'tumble') this.enterTumble(env.shake);

    switch (this.state) {
      case 'fly':
        this.updateFlight(dt, false);
        break;
      case 'scared':
        this.scaredT -= dt;
        this.updateFlight(dt, true);
        if (this.scaredT <= 0) {
          this.state = 'fly';
          this.stateT = 0;
          this.nervous = 5;
        }
        break;
      case 'approach':
        this.updateApproach(dt);
        break;
      case 'perch':
        this.updatePerch(dt);
        break;
      case 'tumble':
        this.updateTumble(dt, env);
        break;
      case 'dizzy':
        this.updateDizzy(dt);
        break;
    }

    this.applyPose(dt);
    this.lastVel.copy(this.vel);
  }

  enterTumble(level) {
    const wasPerched = this.state === 'perch';
    this.state = 'tumble';
    this.stateT = 0;
    this.tumbleMin = 0.8 + Math.min(level, 4) * 0.35;
    this.vel.add(randomUnit().multiplyScalar(1 + level));
    this.omega.copy(randomUnit()).multiplyScalar(rand(8, 14));
    if (wasPerched) this.perchBlend = 0.5;
  }

  randomPoint(out) {
    const y = rand(Y_MIN + 0.1, Y_MAX - 0.1);
    const r = Math.sqrt(Math.random()) * maxRadius(y) * 0.92;
    const a = rand(0, TAU);
    return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
  }

  updateFlight(dt, scared) {
    this.retarget -= dt;
    if (this.retarget <= 0) {
      if (scared) {
        // Bolt away from the threat in short, jagged hops.
        _a.subVectors(this.pos, this.fearOrigin).normalize().multiplyScalar(0.9);
        this.target.copy(this.pos).addScaledVector(_a.add(randomUnit().multiplyScalar(1.0)).normalize(), rand(0.6, 1.4));
        this.retarget = rand(0.1, 0.22);
        this.cruise = rand(3.6, 5.4);
      } else if (this.stateT > 2.5 && Math.random() < (this.nervous > 0 ? 0.05 : 0.22)) {
        this.beginApproach();
        return;
      } else {
        this.randomPoint(this.target);
        this.retarget = this.nervous > 0 ? rand(0.15, 0.5) : rand(0.3, 1.2);
        this.cruise = this.nervous > 0 ? rand(2, 3.4) : rand(0.9, 2.3);
      }
    }

    _a.subVectors(this.target, this.pos).normalize().multiplyScalar(this.cruise);
    const gain = scared ? 11 : 5.5;
    this.vel.addScaledVector(_a.sub(this.vel), gain * dt);
    // Flies never fly quite straight.
    this.vel.addScaledVector(randomUnit(_b), (scared ? 4 : 1.6) * dt);
    this.vel.clampLength(0, scared ? 6.5 : 3);

    this.pos.addScaledVector(this.vel, dt);
    this.bump(this.collide(0.6));
  }

  bump(impact) {
    if (impact > 0.9) this.onBump?.(impact);
  }

  /** Keep the body inside the jar; returns the speed lost against the wall (0 = no contact). */
  collide(restitution, clearance = WALL_CLEAR, yMin = Y_MIN, yMax = Y_MAX) {
    let impact = 0;
    const p = this.pos;
    const v = this.vel;
    if (p.y < yMin) {
      p.y = yMin;
      if (v.y < 0) {
        impact = Math.max(impact, -v.y);
        v.y = -v.y * restitution;
      }
    } else if (p.y > yMax) {
      p.y = yMax;
      if (v.y > 0) {
        impact = Math.max(impact, v.y);
        v.y = -v.y * restitution;
      }
    }
    const r = Math.hypot(p.x, p.z);
    const R = maxRadius(p.y, clearance);
    if (r > R) {
      const slope = (maxRadius(p.y + 0.02, clearance) - maxRadius(p.y - 0.02, clearance)) / 0.04;
      _c.set(-p.x / r, slope, -p.z / r).normalize();
      p.x *= R / r;
      p.z *= R / r;
      const vn = v.dot(_c);
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        v.addScaledVector(_c, -(1 + restitution) * vn);
      }
    }
    return impact;
  }

  // ----- landing ------------------------------------------------------------

  beginApproach() {
    const p = this.perchPoint;
    if (Math.random() < 0.45) {
      const a = rand(0, TAU);
      const r = Math.sqrt(Math.random()) * (innerRadiusAt(JAR.FLOOR_Y + 0.1) - 0.4);
      p.set(Math.cos(a) * r, FLOOR_REST, Math.sin(a) * r);
      this.perchN.set(0, 1, 0);
      this.perchKind = 'floor';
    } else {
      // The sticker sits low on the front; keep out of its way there so the fly stays visible.
      const y = rand(0.4, 2.1);
      let theta = rand(-Math.PI, Math.PI);
      if (y < 1.15) theta = (Math.random() < 0.5 ? -1 : 1) * rand(1.1, 2.0);
      p.set(Math.sin(theta), 0, Math.cos(theta)).multiplyScalar(innerRadiusAt(y) - BODY_H);
      p.y = y;
      this.perchN.set(-Math.sin(theta), 0, -Math.cos(theta));
      this.perchKind = 'wall';
    }
    this.state = 'approach';
    this.stateT = 0;
  }

  updateApproach(dt) {
    _a.subVectors(this.perchPoint, this.pos);
    const dist = _a.length();
    _a.normalize().multiplyScalar(clamp(dist * 2.6, 0.3, 2.0));
    this.vel.addScaledVector(_a.sub(this.vel), 7 * dt);
    this.pos.addScaledVector(this.vel, dt);
    this.collide(0.3, BODY_H * 0.8, FLOOR_REST - 0.02, Y_MAX);

    if (dist < 0.05) this.land();
    else if (this.stateT > 6) {
      this.state = 'fly';
      this.stateT = 0;
    }
  }

  land() {
    this.state = 'perch';
    this.stateT = 0;
    this.pos.copy(this.perchPoint);
    this.vel.set(0, 0, 0);
    if (this.perchKind === 'floor') {
      this.perchFwd.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
    } else {
      // walk along the wall: sideways or up/down
      const tangent = _a.set(-this.perchN.z, 0, this.perchN.x);
      this.perchFwd.copy(tangent).multiplyScalar(rand(-1, 1)).addScaledVector(UP, rand(-1, 1)).normalize();
    }
    this.perchLeft = rand(3, 9);
    this.perchMode = 'idle';
    this.perchT = rand(0.4, 1);
    this.onLand?.();
  }

  updatePerch(dt) {
    this.perchLeft -= dt;
    this.perchT -= dt;
    const n = this.perchN;

    if (this.perchMode === 'clean') {
      this.cleanBlend = Math.min(1, this.cleanBlend + dt * 6);
    } else {
      this.cleanBlend = Math.max(0, this.cleanBlend - dt * 6);
    }

    if (this.perchMode === 'walk') {
      _a.subVectors(this.walkTarget, this.pos);
      _a.addScaledVector(n, -_a.dot(n));
      if (_a.length() < 0.04 || this.perchT < -4) {
        this.perchMode = 'idle';
        this.perchT = rand(0.3, 1);
      } else {
        _a.normalize();
        this.perchFwd.lerp(_a, damp(9, dt)).normalize();
        if (this.perchFwd.dot(_a) > 0.8) this.pos.addScaledVector(this.perchFwd, 0.34 * dt);
      }
    } else if (this.perchMode === 'turn') {
      this.perchFwd.applyAxisAngle(n, this.turnRate * dt);
      this.turnLeft -= dt;
      if (this.turnLeft <= 0) this.perchMode = 'idle';
    }

    if (this.perchMode === 'idle' || this.perchMode === 'clean') {
      if (this.perchT <= 0) this.pickPerchAction();
    }

    this.stickToSurface();
  }

  /** Keep a perched body on its floor/wall (positions, normal and heading tangent). */
  stickToSurface() {
    const n = this.perchN;
    if (this.perchKind === 'floor') {
      this.pos.y = FLOOR_REST;
      const r = Math.hypot(this.pos.x, this.pos.z);
      const R = innerRadiusAt(JAR.FLOOR_Y + 0.1) - 0.25;
      if (r > R) {
        this.pos.x *= R / r;
        this.pos.z *= R / r;
      }
    } else {
      this.pos.y = clamp(this.pos.y, 0.35, 2.15);
      const r = Math.hypot(this.pos.x, this.pos.z) || 1;
      const Rw = innerRadiusAt(this.pos.y) - BODY_H;
      this.pos.x *= Rw / r;
      this.pos.z *= Rw / r;
      n.set(-this.pos.x, 0, -this.pos.z).normalize();
      this.perchFwd.addScaledVector(n, -this.perchFwd.dot(n)).normalize();
    }
  }

  pickPerchAction() {
    if (this.perchLeft <= 0) {
      this.takeOff();
      return;
    }
    const r = Math.random();
    if (r < 0.4) {
      this.perchMode = 'clean';
      this.perchT = rand(1.2, 2.6);
    } else if (r < 0.65) {
      this.perchMode = 'walk';
      this.perchT = 0;
      const n = this.perchN;
      if (this.perchKind === 'floor') {
        const a = rand(0, TAU);
        const rr = Math.sqrt(Math.random()) * (innerRadiusAt(JAR.FLOOR_Y + 0.1) - 0.45);
        this.walkTarget.set(Math.cos(a) * rr, FLOOR_REST, Math.sin(a) * rr);
      } else {
        randomUnit(_a).multiplyScalar(rand(0.3, 0.7));
        _a.addScaledVector(n, -_a.dot(n)); // stay in the wall's tangent plane
        this.walkTarget.copy(this.pos).add(_a);
        this.walkTarget.y = clamp(this.walkTarget.y, 0.4, 2.1);
      }
    } else if (r < 0.8) {
      this.perchMode = 'turn';
      this.turnLeft = rand(0.25, 0.6);
      this.turnRate = (Math.random() < 0.5 ? -1 : 1) * rand(2, 4);
    } else {
      this.perchMode = 'idle';
      this.perchT = rand(0.5, 1.6);
    }
  }

  takeOff() {
    this.state = 'fly';
    this.stateT = 0;
    this.vel.copy(this.perchN).multiplyScalar(1.2).addScaledVector(this.perchFwd, 0.6);
    this.heading.copy(this.vel).normalize();
    this.retarget = 0;
    this.cleanBlend = 0;
  }

  // ----- tumbling and recovering -------------------------------------------

  updateTumble(dt, env) {
    this.cleanBlend = 0;
    _a.copy(env.gravity);
    if (env.shake > 0.05) _a.addScaledVector(randomUnit(_b), env.shake * 32);
    this.vel.addScaledVector(_a, dt);
    this.vel.multiplyScalar(Math.exp(-0.9 * dt));
    this.pos.addScaledVector(this.vel, dt);

    const w = this.omega.length();
    if (w > 1e-3) {
      _q.setFromAxisAngle(_b.copy(this.omega).multiplyScalar(1 / w), w * dt);
      this.quat.premultiply(_q).normalize();
    }
    this.omega.multiplyScalar(Math.exp(-1.2 * dt));

    const impact = this.collide(0.5, WALL_CLEAR * 0.7, FLOOR_REST - 0.02, Y_MAX);
    if (impact > 0.6) {
      this.omega.addScaledVector(randomUnit(_b), impact * 2);
      this.bump(impact * 1.3);
    }

    const onFloor = this.pos.y <= FLOOR_REST + 0.03;
    if (onFloor) {
      this.vel.x *= Math.exp(-4 * dt);
      this.vel.z *= Math.exp(-4 * dt);
      this.omega.multiplyScalar(Math.exp(-3 * dt));
    }

    if (this.stateT > this.tumbleMin && env.shake < 0.4) {
      if (onFloor && this.vel.length() < 0.7) {
        this.state = 'dizzy';
        this.stateT = 0;
        this.dizzyT = rand(1.5, 3);
        this.vel.set(0, 0, 0);
        this.upsideDown = Math.random() < 0.65;
        this.perchFwd.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
      } else if (this.stateT > this.tumbleMin + 0.45) {
        this.recover(2.2);
      }
    }
  }

  updateDizzy(dt) {
    this.pos.y += (FLOOR_REST - 0.02 - this.pos.y) * damp(12, dt);
    this.vel.set(0, 0, 0);
    if (this.stateT > this.dizzyT) this.recover(1.6);
  }

  recover(hop) {
    this.state = 'scared';
    this.stateT = 0;
    this.scaredT = rand(0.7, 1.4);
    this.fearOrigin.copy(this.pos).addScaledVector(randomUnit(_a), 0.4);
    this.vel.y = Math.max(this.vel.y, hop);
    this.retarget = 0;
    this.heading.set(this.vel.x, 0, this.vel.z);
    if (this.heading.lengthSq() < 1e-3) this.heading.set(0, 0, 1);
    this.heading.normalize();
  }

  // ----- pose ---------------------------------------------------------------

  applyPose(dt) {
    const m = this.model;
    const state = this.state;
    const flying = state === 'fly' || state === 'scared' || state === 'approach';

    // Blend factor towards the perched pose.
    const perched = state === 'perch' || state === 'dizzy';
    this.perchBlend += ((perched ? 1 : 0) - this.perchBlend) * damp(perched ? 14 : 18, dt);

    // Orientation.
    if (state === 'tumble') {
      // integrated in updateTumble
    } else if (state === 'perch') {
      basisQuat(_q, this.perchFwd, this.perchN);
      this.quat.slerp(_q, damp(14, dt));
    } else if (state === 'dizzy') {
      _a.set(0, this.upsideDown ? -1 : 1, 0);
      basisQuat(_q, this.perchFwd, _a);
      this.quat.slerp(_q, damp(10, dt));
    } else {
      const speed = this.vel.length();
      if (speed > 0.25) this.heading.lerp(_a.copy(this.vel).multiplyScalar(1 / speed), damp(state === 'scared' ? 16 : 9, dt)).normalize();
      basisQuat(_q, this.heading, UP);
      // Lean into turns.
      _a.subVectors(this.vel, this.lastVel).multiplyScalar(1 / Math.max(dt, 1e-3));
      _b.crossVectors(UP, this.heading).normalize();
      this.bank += (clamp(-_a.dot(_b) * 0.05, -0.65, 0.65) - this.bank) * damp(8, dt);
      _q.multiply(_qi.setFromAxisAngle(_c.set(0, 0, 1), this.bank));
      this.quat.slerp(_q, damp(state === 'scared' ? 26 : 13, dt));
    }

    m.root.position.copy(this.pos);
    m.root.quaternion.copy(this.quat);

    // Head tilts down while grooming; bobs a little in flight.
    m.head.rotation.x += (this.cleanBlend * 0.3 - m.head.rotation.x) * damp(12, dt);
    m.body.position.y = flying ? Math.sin(this.time * 47) * 0.0025 : 0;

    this.poseWings(dt);
    this.poseLegs(dt);
    this.updateBuzz();
  }

  poseWings(dt) {
    let amp = 1;
    let fold = 0;
    switch (this.state) {
      case 'perch':
        amp = 0;
        fold = 1;
        break;
      case 'dizzy':
        amp = 0.3 + 0.7 * Math.max(0, Math.sin(this.time * 3.1)) ** 4;
        fold = 0;
        break;
      case 'tumble':
        amp = 0.85;
        break;
    }
    if (this.wingCommand) ({ amp, fold } = this.wingCommand);
    this.wingAmp += (amp - this.wingAmp) * damp(14, dt);
    this.wingFold += (fold - this.wingFold) * damp(this.state === 'perch' ? 9 : 22, dt);
    this.flapPhase += dt * TAU * (11.3 + (this.state === 'scared' ? 2.5 : 0));

    // Stroke: the tip sweeps back and forth (positive = backwards) while heaving up and down.
    const drive = this.wingAmp * (1 - this.wingFold);
    const sin = Math.sin(this.flapPhase);
    const cos = Math.cos(this.flapPhase);
    const blur = this.wingAmp > 0.08;
    for (const w of this.model.wings) {
      w.node.visible = w.ghost === 0 || blur;
      const sweep = drive * (0.35 + 0.85 * sin + w.ghost);
      const heave = drive * 0.32 * cos;
      _qf.copy(IDENTITY).slerp(w.rest, this.wingFold); // spread -> folded over the back
      _qy.setFromAxisAngle(AX_Y, w.side * sweep);
      _qz.setFromAxisAngle(AX_Z, w.side * heave);
      w.node.quaternion.copy(_qz).multiply(_qy).multiply(_qf);
    }
  }

  poseLegs(dt) {
    const m = this.model;
    const root = m.root;
    _qi.copy(root.quaternion).invert();
    const p = this.perchBlend;
    const dizzy = this.state === 'dizzy';
    const stepping = { 0: false, 1: false };
    for (const leg of m.legs) if (leg.stepT < 1) stepping[leg.group] = true;

    for (const leg of m.legs) {
      // Standing target for this leg, in jar-local coordinates.
      _a.copy(leg.home).applyQuaternion(root.quaternion).add(root.position);

      if (p < 0.05) {
        leg.planted.copy(_a);
        leg.stepT = 1;
      } else if (leg.stepT < 1) {
        leg.stepT = Math.min(1, leg.stepT + dt / 0.11);
        const t = leg.stepT;
        leg.planted.lerpVectors(leg.stepFrom, leg.stepTo, t * t * (3 - 2 * t));
        leg.planted.addScaledVector(this.perchN, Math.sin(Math.PI * t) * 0.045);
      } else if (leg.planted.distanceTo(_a) > 0.075 && !stepping[1 - leg.group] && this.state === 'perch') {
        leg.stepFrom.copy(leg.planted);
        leg.stepTo.copy(_a).addScaledVector(_b.copy(this.perchFwd), 0.035);
        leg.stepT = 0;
        stepping[leg.group] = true;
      }

      // Tucked / dangling pose while flying.
      const sway = Math.sin(this.time * 9 + leg.idx * 1.7 + leg.side) * 0.01;
      _goal.copy(leg.tuck);
      _goal.y += sway;
      if (this.state === 'tumble' || dizzy) {
        const w = Math.sin(this.time * (dizzy ? 11 : 17) + leg.idx * 2.1 + (leg.side > 0 ? 0 : 1.7));
        _goal.x += leg.side * 0.04 * Math.abs(w);
        _goal.y -= 0.03 + 0.05 * w * (dizzy ? 1.4 : 0.6);
        _goal.z += 0.03 * Math.cos(this.time * 7 + leg.idx);
      }

      // A lying fly waves its legs in the air; otherwise blend towards the planted foot.
      if (!dizzy) {
        _b.copy(leg.planted).sub(root.position).applyQuaternion(_qi);
        _goal.lerp(_b, p);
      }
      _goal.add(leg.twitch);

      // Front legs rub together while grooming.
      if (leg.idx === 0 && this.cleanBlend > 0.01) {
        const ph = this.time * 9 + (leg.side > 0 ? 0 : Math.PI);
        _b.set(leg.side * (0.03 + 0.025 * Math.sin(ph)), -0.045, 0.23 + 0.025 * Math.cos(ph));
        _goal.lerp(_b, this.cleanBlend);
      }

      solveLeg(leg, _goal);
    }
  }

  updateBuzz() {
    const speed = this.vel.length();
    this.buzzSpeed = clamp(speed / 5, 0, 1);
    switch (this.state) {
      case 'perch':
        this.buzz = 0;
        break;
      case 'dizzy':
        this.buzz = this.wingAmp > 0.5 ? 0.35 : 0.1;
        break;
      case 'scared':
        this.buzz = 1;
        break;
      case 'tumble':
        this.buzz = 0.75;
        break;
      case 'approach':
        this.buzz = 0.5;
        break;
      default:
        this.buzz = 0.55 + 0.3 * this.buzzSpeed;
    }
  }
}
