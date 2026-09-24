import * as THREE from 'three';
import { Fly } from './fly.js';
import { BODY_H } from './flymodel.js';
import { JAR, innerRadiusAt } from './jar.js';

// A fly whose behaviour comes from the MaleCNS connectome.
//
//   body -> brain:  touch, vibration, approaching objects, wind and leg load become drive (mV)
//                   on the matching sensory neurons (groups from tools/build_groups.py)
//   brain -> body:  firing rates of motor-neuron and descending-neuron pools are turned into
//                   wing power, steering, leg twitches, head turns ... by fixed gains
//
// There is no behaviour script: nothing here decides to fly, walk or groom. The only rules are
// the physics of the body (lift needs wing power, feet stick to glass) and the gain constants.

const { Vector3: V3 } = THREE;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const FLOOR_REST = JAR.FLOOR_Y + BODY_H;

// ---- sensory drive levels (mV of tonic synaptic input, see tools/explore*.py) ----
const AMBIENT_LIGHT = 8;
const LEG_LOAD = 7; // campaniform sensilla / hair plates while standing
const LEG_TOUCH = 5;
const TOUCH = 12; // a poke
const VIBRATION = 12; // a knock on the glass

// ---- read-out gains ----
const POWER_HZ = 140; // DLM/DVM rate that counts as full flight power
const TAKEOFF_POWER = 0.28;
const V_MAX = 2.4; // cruise speed at full power, units/s
const YAW_GAIN = 2.6; // rad/s per unit of steering signal
const GRAVITY = 14;
const AIR_CLEAR = 0.34; // body-centre distance to the glass while flying

const _up = new V3();
const _h = new V3();
const _v = new V3();

/** Which sensory groups does a touch on this body part excite? */
export function touchGroups(part, localX) {
  const side = part.startsWith('l') ? 'L' : part.startsWith('r') && part[1] !== 'o' ? 'R' : localX >= 0 ? 'L' : 'R';
  const leg = part.match(/^[lr]([fmh])_/);
  if (leg) return [`touch_leg_${leg[1]}_${side}`];
  if (/wing/.test(part)) return [`touch_wing_${side}`];
  if (/haltere/.test(part)) return [`haltere_${side}`];
  if (/abdomen/.test(part)) return [`touch_abdomen_${side}`];
  if (/antenna/.test(part)) return [`jo_ab_${side}`, `jo_cef_${side}`];
  if (/head|rostrum|haustellum|labrum/.test(part)) return [`bm_${side}`];
  return [`touch_notum_${side}`]; // thorax
}

/** Sensory drive of a fly standing quietly on the floor (used to settle the brain at start-up). */
export function restingDrive() {
  const drive = { pr_L: AMBIENT_LIGHT, pr_R: AMBIENT_LIGHT };
  for (const leg of 'fmh') {
    for (const side of 'LR') {
      drive[`prop_leg_${leg}_${side}`] = LEG_LOAD;
      drive[`touch_leg_${leg}_${side}`] = LEG_TOUCH;
    }
  }
  return drive;
}

/**
 * Faint Poisson input (~2 Hz per neuron) on the mechanosensors, meant as air currents and table
 * vibration. Measured (tools/explore/explore11.py): with the resting drive above, nothing happens up
 * to ~30 Hz, and from ~40 Hz the network flips into sustained excitation and stays there, so there is
 * no rate that makes the resting fly twitch now and then. At 2 Hz this is inert; the fly stays still
 * until something touches it.
 */
export function ambientNoise() {
  const groups = ['bm', 'jo_ab', 'jo_cef', 'touch_notum', 'touch_wing', 'touch_abdomen', 'haltere', 'prop_wing', 'touch_leg_f', 'touch_leg_m', 'touch_leg_h'];
  return { groups: groups.flatMap((g) => [`${g}_L`, `${g}_R`]), rate: 2 };
}

export class BrainFly extends Fly {
  constructor(assets, link) {
    super(assets);
    this.link = link;
    this.events = []; // transient sensory events: { group, value, t0, dur }
    this.threat = { strength: 0, side: 'R' }; // something approaching (set by the app each frame)
    this.power = 0; // smoothed flight power, 0..1.5
    this.steer = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.abdCurl = 0;
    this.proboscis = 0;
    this.brainOn = false;
    // start on the floor, like a fly that has just settled
    this.beginStand('floor', new V3(0.15, 0, 0.3));
  }

  get useBrain() {
    return this.link?.ready === true;
  }

  get activity() {
    if (!this.useBrain) return super.activity;
    if (this.state !== 'perch' || this.events.length) return 1;
    let twitch = 0;
    for (const leg of this.model.legs) twitch = Math.max(twitch, leg.twitch.length());
    return Math.max(this.power * 3, Math.abs(this.headYaw) * 3, this.headPitch * 3, this.abdCurl * 2, this.proboscis * 2, twitch * 20, this.threat.strength * 3);
  }

  // ----- stimuli (called by the app) ---------------------------------------

  /** A short sensory event on one or more groups. */
  addEvent(groups, value, dur = 0.15) {
    for (const group of [].concat(groups)) this.events.push({ group, value, t0: this.time, dur });
  }

  /** Touch on a body part; `localX` is the hit point's x in fly space (+x = the fly's left). */
  touch(part, localX, strength = 1) {
    this.addEvent(touchGroups(part, localX), TOUCH * strength, 0.25);
  }

  /** A knock on the glass or the jar being jolted: vibration through the legs and antennae. */
  knock(strength = 1) {
    this.addEvent(['jo_ab_L', 'jo_ab_R', 'haltere_L', 'haltere_R'], VIBRATION * strength, 0.12);
  }

  startle(origin, radius = 1.2) {
    if (!this.useBrain) return super.startle(origin, radius);
    // a knock reaches the fly as vibration, weaker with distance; what it does is up to the brain
    this.knock(clamp(1 - this.pos.distanceTo(origin) / (radius * 1.6), 0.15, 1));
  }

  // ----- simulation ----------------------------------------------------------

  update(dt, env) {
    if (!this.useBrain) {
      this.wingCommand = null;
      return super.update(dt, env);
    }
    this.time += dt;
    this.stateT += dt;
    this.sense(dt, env);
    this.read(dt);

    if (env.shake > 1 && this.state !== 'tumble') this.enterTumble(env.shake);
    switch (this.state) {
      case 'perch':
        this.updateStand(dt);
        break;
      case 'tumble':
        this.wingCommand = null;
        this.updateTumble(dt, env);
        break;
      case 'dizzy':
        this.wingCommand = null;
        this.updateDizzy(dt);
        break;
      default:
        this.state = 'fly';
        this.updateAir(dt, env);
    }
    this.applyPose(dt);
    this.poseBrain();
    this.lastVel.copy(this.vel);
  }

  /** Body state and events -> drive on sensory groups -> the brain. */
  sense(dt, env) {
    const drive = {};
    const put = (group, value) => {
      if (value > (drive[group] ?? 0)) drive[group] = value;
    };
    const both = (prefix, value) => {
      put(`${prefix}_L`, value);
      put(`${prefix}_R`, value);
    };
    both('pr', AMBIENT_LIGHT);
    if (this.state === 'perch') {
      for (const leg of 'fmh') {
        both(`prop_leg_${leg}`, LEG_LOAD);
        both(`touch_leg_${leg}`, LEG_TOUCH);
      }
    }
    if (this.state === 'fly' || this.state === 'tumble') {
      both('jo_cef', clamp(this.vel.length() * 4.5, 0, 12)); // wind on the antennae
    }
    both('haltere', 9 * this.wingAmp * (1 - this.wingFold)); // the halteres feel the wingbeat
    if (env.shake > 0.05) {
      both('haltere', 6 + 6 * Math.min(1, env.shake));
      both('prop_leg_m', 6 + 5 * Math.min(1, env.shake));
    }
    if (this.threat.strength > 0.02) put(`looming_${this.threat.side}`, 7.5 + 6 * this.threat.strength);
    this.events = this.events.filter((e) => this.time - e.t0 < e.dur);
    for (const e of this.events) put(e.group, e.value * (1 - (this.time - e.t0) / e.dur));
    this.link.update(drive, dt * 1000);
  }

  /** Motor rates -> body commands. */
  read(dt) {
    const r = (name) => this.link.rate(name);
    const wantedPower = clamp((this.link.both('mn_dlm') + this.link.both('mn_dvm')) / 2 / POWER_HZ, 0, 1.6);
    // wing muscles and wing inertia: fast to spin up, slow to spin down
    this.power += (wantedPower - this.power) * damp(wantedPower > this.power ? 14 : 0.9, dt);
    // steering muscles: the side that is more active turns the fly away from it (sign convention)
    const steerWanted =
      (r('mn_wsteer_L') - r('mn_wsteer_R') + 0.6 * (r('mn_neck_L') - r('mn_neck_R')) + 0.4 * (r('dn_L') - r('dn_R'))) / 40;
    this.steer += (steerWanted - this.steer) * damp(10, dt);

    this.headYaw += (clamp(0.03 * (r('mn_neck_L') - r('mn_neck_R')), -0.6, 0.6) - this.headYaw) * damp(12, dt);
    this.headPitch += (clamp(0.012 * (r('mn_neck_L') + r('mn_neck_R')), 0, 0.5) - this.headPitch) * damp(12, dt);
    this.abdCurl += (clamp(this.link.both('mn_abd') / 60, 0, 1) - this.abdCurl) * damp(10, dt);
    this.proboscis += (clamp(this.link.both('mn_prob') / 50, 0, 1) - this.proboscis) * damp(8, dt);

    for (const leg of this.model.legs) {
      const l = 'fmh'[leg.idx];
      const s = leg.side > 0 ? 'L' : 'R';
      const lift = clamp(r(`mn_leg_${l}_sw_${s}`) / 50, 0, 1); // extensors / levators
      const pull = clamp(r(`mn_leg_${l}_st_${s}`) / 50, 0, 1); // flexors / depressors
      const kx = damp(14, dt);
      leg.twitch.x += (leg.side * 0.04 * lift - leg.twitch.x) * kx;
      leg.twitch.y += (0.1 * lift - 0.04 * pull - leg.twitch.y) * kx;
      leg.twitch.z += (0.06 * (lift - pull) - leg.twitch.z) * kx;
    }
  }

  // ----- standing, flying, landing ------------------------------------------

  updateStand(dt) {
    this.cleanBlend = 0;
    this.stickToSurface();
    if (this.power > TAKEOFF_POWER) this.takeOff();
    this.wingCommand = { amp: 0, fold: this.power < 0.1 ? 1 : 0 };
  }

  takeOff() {
    const push = clamp(this.link.both('mn_leg_m_sw') / 60, 0, 1); // the jump comes from the legs
    this.state = 'fly';
    this.stateT = 0;
    this.heading.copy(this.perchFwd);
    if (this.perchKind === 'wall') this.heading.addScaledVector(this.perchN, 0.6).normalize();
    this.vel.copy(this.perchN).multiplyScalar(0.9 + 1.6 * push).addScaledVector(this.heading, 0.5);
  }

  updateAir(dt, env) {
    _up.copy(env.gravity).negate().normalize();
    const powered = smoothstep(0.08, 0.3, this.power);
    // steering: rotate the heading about the up axis
    this.heading.applyAxisAngle(_up, YAW_GAIN * this.steer * powered * dt);
    this.heading.addScaledVector(_up, -this.heading.dot(_up)).normalize();

    const lift = clamp((this.power - 0.1) / 0.4, 0, 1.15);
    const cruise = V_MAX * clamp(this.power / 0.7, 0, 1);
    // horizontal: relax towards heading * cruise; vertical: lift against gravity
    const vUp = this.vel.dot(_up);
    _v.copy(this.vel).addScaledVector(_up, -vUp);
    _h.copy(this.heading).multiplyScalar(cruise);
    this.vel.addScaledVector(_h.sub(_v), damp(3, dt));
    const ay = (lift - 1) * GRAVITY - 0.9 * vUp;
    this.vel.addScaledVector(_up, ay * dt);
    this.vel.clampLength(0, 6);
    this.pos.addScaledVector(this.vel, dt);

    const impact = this.collide(0.45, AIR_CLEAR, FLOOR_REST - 0.02, 2.5);
    if (impact > 0.7) this.crash(impact);

    this.wingCommand = { amp: clamp(this.power / 0.35, 0, 1), fold: 0 };
    const r = Math.hypot(this.pos.x, this.pos.z);
    const wallR = innerRadiusAt(this.pos.y) - AIR_CLEAR;
    const speed = this.vel.length();
    if (this.power < 0.3 && speed < 1.6) {
      if (this.pos.y <= FLOOR_REST + 0.03) this.beginStand('floor', this.pos);
      else if (r >= wallR - 0.02 && this.pos.y > 0.4 && this.pos.y < 2.15) this.beginStand('wall', this.pos);
    }
  }

  /** Hit the glass: mechanosensors on the side that took the impact fire. */
  crash(impact) {
    this.bump(impact);
    const s = clamp(impact / 4, 0.3, 1);
    _v.copy(this.pos).setY(0).normalize(); // outward wall normal
    _h.crossVectors(_v, this.heading); // which side hit: sign against up
    const side = _h.y > 0 ? 'R' : 'L';
    const head = _v.dot(this.heading) > 0.6;
    this.addEvent(head ? ['bm_L', 'bm_R'] : [`touch_wing_${side}`, `touch_leg_m_${side}`], TOUCH * s, 0.14);
    this.addEvent(['haltere_L', 'haltere_R'], 8 * s, 0.14);
  }

  /** Come to rest on the floor or the wall (feet stick to glass). */
  beginStand(kind, where) {
    this.state = 'perch';
    this.stateT = 0;
    this.perchKind = kind;
    this.vel.set(0, 0, 0);
    this.pos.copy(where);
    if (kind === 'floor') {
      this.perchN.set(0, 1, 0);
      this.pos.y = FLOOR_REST;
      this.perchFwd.set(this.heading.x, 0, this.heading.z);
      if (this.perchFwd.lengthSq() < 1e-4) this.perchFwd.set(0, 0, 1);
    } else {
      this.perchN.set(-this.pos.x, 0, -this.pos.z).normalize();
      this.perchFwd.copy(this.heading).addScaledVector(this.perchN, -this.heading.dot(this.perchN));
      if (this.perchFwd.lengthSq() < 1e-4) this.perchFwd.set(0, 1, 0);
    }
    this.perchFwd.normalize();
    this.stickToSurface();
    this.onLand?.();
  }

  /** Override: after a tumble the fly either keeps flying (if the brain powers the wings) or settles. */
  recover(hop) {
    if (this.pos.y <= FLOOR_REST + 0.06 && this.vel.length() < 1.2) {
      this.heading.set(this.perchFwd.x, 0, this.perchFwd.z);
      this.beginStand('floor', this.pos);
    } else {
      this.state = 'fly';
      this.stateT = 0;
      this.heading.set(this.vel.x, 0, this.vel.z);
      if (this.heading.lengthSq() < 1e-3) this.heading.set(0, 0, 1);
      this.heading.normalize();
    }
  }

  // ----- pose ---------------------------------------------------------------

  updateBuzz() {
    super.updateBuzz();
    if (!this.useBrain) return;
    if (this.state === 'perch') this.buzz = 0;
    else if (this.state === 'fly') this.buzz = clamp(0.1 + this.power, 0, 1);
    this.buzzSpeed = clamp(0.2 + this.power * 0.6, 0, 1);
  }

  /** Head, abdomen and proboscis follow their motor pools. */
  poseBrain() {
    if (!this.useBrain) return;
    const m = this.model;
    m.setHead(this.headPitch, this.headYaw);
    m.bendAbdomen(-0.9 * this.abdCurl);
    m.setProboscis(this.proboscis);
  }
}
