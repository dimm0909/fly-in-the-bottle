import * as THREE from 'three';
import { Fly, rand, randomUnit } from './fly.js';
import { BODY_H } from './flymodel.js';
import { JAR, innerRadiusAt } from './jar.js';

// A fly whose behaviour comes from the MaleCNS connectome.
//
//   body -> brain:  touch, vibration, approaching objects, wind, rotation and leg load become drive (mV)
//                   on the matching sensory neurons (groups from tools/build_groups.py)
//   brain -> body:  firing rates of motor-neuron and descending-neuron pools are turned into
//                   wing power, steering, walking, leg twitches, head turns ... by fixed gains
//
// There is no behaviour script: nothing here decides to fly, walk, groom or right itself. The only rules are
// the physics of the body (the wings and the jump muscle push against the weight and the grip of the feet, a knock
// spins a body that has nothing to hold it upright, feet stick to glass) and the gain constants. What the body
// supplies is rhythm: the network has no rhythm generator, so the feet plant and swing on their own (poseLegs in
// fly.js) as the body is carried along by the walking command, and the front legs rub at a fixed pace when the
// grooming neurons fire.

const { Vector3: V3, Quaternion } = THREE;
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
const HALTERE_PER_RAD = 0.9; // haltere drive per rad/s of body rotation: the halteres are the gyroscopes
// A small object moving in the visual field, strength 0..1: LC10d on its side steers, LC9 on both sides walks.
const OBJECT_STEER = [7, 3]; // mV = base + gain * strength (nothing below ~7.5 mV, see explore12.py)
const OBJECT_WALK = [6.5, 2];

// ---- read-out gains ----
const POWER_HZ = 140; // DLM/DVM rate that counts as full flight power
const TTM_HZ = 30; // TTMn (the jump muscle) rate that counts as a full jump
const GROOM_HZ = 40; // aDN1 + aDN2 rate that counts as full grooming
const V_MAX = 2.4; // cruise speed at full power, units/s
const YAW_GAIN = 2.6; // rad/s per unit of steering signal
const GRAVITY = 14;
const AIR_CLEAR = 0.34; // body-centre distance to the glass while flying
const AIR_DRAG = 0.9; // 1/s: what slows a body that is not beating its wings
// Leaving and touching the glass (units/s^2, gravity is 14): the wings and the jump muscle push the body away from the
// surface, the weight and the grip of the feet hold it. Nothing else decides between standing and flying.
const ADHESION = 5; // grip of the feet against being pulled off (about a third of the weight)
const JUMP_ACCEL = 150; // the jump muscle at full drive; it works as a burst, so the push goes with the square of the rate
const LIFTOFF_GAP = 0.02; // how far the body must get off the glass to count as airborne
const WALK_MAX = 0.36; // units/s at full forward drive: about what the stepping keeps up with
const WALK_HZ = 15; // DNp09 rate (mean of both sides) that gives full forward speed
const BACK_HZ = 20; // MDN rate that gives full backward speed
const TURN_HZ = 30; // DNa02 (plus half of DNa01) left-minus-right rate that gives a full turn
const TURN_RATE = 2.2; // rad/s at a full turn

// ---- physics of being thrown about ----
const DISLODGE_SHAKE = 1; // shaking this hard tears the feet off the glass
const SHAKE_ACCEL = 32; // random push on a fly in the air, per unit of shake (units/s^2)
const POKE_SPEED = 2.8;
const SETTLE_SPIN = 3; // rad/s: a fly spinning faster than this has not landed yet

// ---- rare random events on a standing fly ----
// Air currents, a crumb, a shadow passing: every few seconds one of these hits a random place. A weak one does
// nothing visible; a stronger one makes the network twitch, turn, walk or bolt (the response is close to
// all-or-nothing, see tools/explore/explore13.py, which draws the same events). Strength s is 0..1 and a group is
// driven with `base + gain * s` mV; a touch fades out over its duration, an object stays.
const AMBIENT_GAP = [5, 10]; // s: at least this long, plus an exponential tail with this mean
// Dust on the head keeps the bristles under load until the front legs wipe it off; the network only answers with a
// burst of grooming (about half a second, then it adapts), so a bout is repeated until the dust is gone.
const DUST = [8, 4]; // mV on the head bristles (both sides) = base + gain * dust, dust 0..1
const CLEAN_RATE = 0.3; // dust wiped off per second by a full grooming effort
const isHead = (part) => /head|rostrum|haustellum|labrum/.test(part);
const bySide = (group) => (side) => [[`${group}_${side}`, 0, TOUCH]];
const AMBIENT_EVENTS = [
  { w: 32, s: [0.35, 0.9], dur: [0.15, 0.3], groups: (side, leg) => [[`touch_leg_${leg}_${side}`, 0, TOUCH]] },
  { w: 8, s: [0.35, 0.9], dur: [0.15, 0.3], groups: bySide('touch_wing') },
  { w: 8, s: [0.35, 0.9], dur: [0.15, 0.3], groups: bySide('touch_notum') },
  { w: 8, s: [0.35, 0.9], dur: [0.15, 0.3], groups: bySide('touch_abdomen') },
  { w: 8, dust: [0.5, 1] }, // something settles on the head
  { w: 6, s: [0.35, 0.9], dur: [0.15, 0.3], groups: (side) => [[`jo_ab_${side}`, 0, TOUCH], [`jo_cef_${side}`, 0, TOUCH]] },
  { w: 6, s: [0.4, 0.85], dur: [0.4, 0.9], groups: bySide('jo_cef') }, // a gust
  {
    w: 4,
    s: [0.3, 0.75],
    dur: [0.1, 0.2],
    groups: () => ['jo_ab_L', 'jo_ab_R', 'haltere_L', 'haltere_R'].map((g) => [g, 0, VIBRATION]), // the table shakes
  },
  { w: 20, s: [0.5, 1], dur: [0.5, 1.5], object: true },
];
const AMBIENT_TOTAL = AMBIENT_EVENTS.reduce((sum, e) => sum + e.w, 0);

const _up = new V3();
const _h = new V3();
const _v = new V3();
const _qs = new Quaternion();
const _n = new V3();

/** Which sensory groups does a touch on this body part excite? */
export function touchGroups(part, localX) {
  const side = part.startsWith('l') ? 'L' : part.startsWith('r') && part[1] !== 'o' ? 'R' : localX >= 0 ? 'L' : 'R';
  const leg = part.match(/^[lr]([fmh])_/);
  if (leg) return [`touch_leg_${leg[1]}_${side}`];
  if (/wing/.test(part)) return [`touch_wing_${side}`];
  if (/haltere/.test(part)) return [`haltere_${side}`];
  if (/abdomen/.test(part)) return [`touch_abdomen_${side}`];
  if (/antenna/.test(part)) return [`jo_ab_${side}`, `jo_cef_${side}`];
  if (isHead(part)) return [`bm_${side}`];
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

export class BrainFly extends Fly {
  constructor(assets, link) {
    super(assets);
    this.link = link;
    this.events = []; // transient sensory events: { group, value, t0, dur }
    this.threat = { strength: 0, side: 'R' }; // something approaching (set by the app each frame)
    this.seen = { strength: 0, side: 'R' }; // something small moving in the visual field (see seeObject)
    this.passing = { s: 0, side: 'R', until: 0 }; // a random object event in progress
    this.nextAmbient = AMBIENT_GAP[0] - AMBIENT_GAP[1] * Math.log(1 - Math.random());
    this.power = 0; // smoothed flight power, 0..1.5
    this.steer = 0;
    this.walk = 0; // smoothed walking command, -1 (backwards) .. 1 (forwards)
    this.turn = 0; // smoothed turning command, -1 (right) .. 1 (left)
    this.groom = 0; // smoothed grooming command, 0..1
    this.jump = 0; // the jump muscle, 0..1
    this.dust = 0; // how much there is on the head, 0..1 (see DUST)
    this.gap = 0; // how far a standing body has been pushed off the glass, and how fast (see pullOff)
    this.gapV = 0;
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
    if (this.state !== 'perch' || this.events.length || this.dust > 0.02) return 1;
    let twitch = 0;
    for (const leg of this.model.legs) twitch = Math.max(twitch, leg.twitch.length());
    return Math.max(
      this.power * 3,
      Math.abs(this.headYaw) * 3,
      this.headPitch * 3,
      this.abdCurl * 2,
      this.proboscis * 2,
      twitch * 20,
      this.threat.strength * 3,
      Math.abs(this.walk) * 3,
      Math.abs(this.turn) * 3,
      this.cleanBlend * 3,
      this.seen.strength * 3,
    );
  }

  // ----- stimuli (called by the app) ---------------------------------------

  /** A short sensory event on one or more groups. */
  addEvent(groups, value, dur = 0.15) {
    for (const group of [].concat(groups)) this.events.push({ group, value, t0: this.time, dur });
  }

  /** Touch on a body part; `localX` is the hit point's x in fly space (+x = the fly's left). */
  touch(part, localX, strength = 1) {
    this.addEvent(touchGroups(part, localX), TOUCH * strength, 0.25);
    if (isHead(part)) this.dust = Math.max(this.dust, strength); // whatever touched the head leaves the bristles stimulated
  }

  /** A knock on the glass or the jar being jolted: vibration through the legs and antennae. */
  knock(strength = 1) {
    this.addEvent(['jo_ab_L', 'jo_ab_R', 'haltere_L', 'haltere_R'], VIBRATION * strength, 0.12);
  }

  /** A small object moves in the visual field on `side` (strength 0..1); the retina forgets it in a fraction of a second. */
  seeObject(strength, side) {
    if (strength <= this.seen.strength) return;
    this.seen.strength = strength;
    this.seen.side = side;
  }

  startle(origin, radius = 1.2) {
    if (!this.useBrain) return super.startle(origin, radius);
    // a knock reaches the fly as vibration, weaker with distance; what it does is up to the brain
    this.knock(clamp(1 - this.pos.distanceTo(origin) / (radius * 1.6), 0.15, 1));
  }

  poke(dir) {
    if (!this.useBrain) return super.poke(dir);
    // a real knock: momentum and some spin carry the fly off its footing; the touch reaches the brain separately
    this.launch(_v.copy(dir).normalize().multiplyScalar(POKE_SPEED).addScaledVector(randomUnit(_h), 0.8), rand(9, 16));
    this.onPoke?.();
  }

  /** Throw the body into the air with a velocity and a spin (rad/s about a random axis). */
  launch(vel, spin) {
    if (this.state === 'perch') {
      this.heading.copy(this.perchFwd);
      this.perchBlend = Math.min(this.perchBlend, 0.5);
    }
    this.state = 'fly';
    this.stateT = 0;
    this.vel.copy(vel);
    this.omega.copy(randomUnit(_h)).multiplyScalar(spin);
  }

  // ----- simulation ----------------------------------------------------------

  update(dt, env) {
    if (!this.useBrain) {
      this.wingCommand = null;
      return super.update(dt, env);
    }
    this.time += dt;
    this.stateT += dt;
    this.ambient(dt);
    this.sense(dt, env);
    this.read(dt);

    // shaken hard enough the feet let go; from then on it is physics and whatever the brain makes of it
    if (this.state === 'perch' && env.shake > DISLODGE_SHAKE) {
      this.launch(randomUnit(_v).multiplyScalar(1 + env.shake), rand(8, 14));
    }
    if (this.state === 'perch') {
      this.updateStand(dt, env);
    } else {
      this.state = 'fly';
      this.updateAir(dt, env);
    }
    // the wings follow the flight muscles wherever the fly is; standing, they stay folded until the muscles pull hard
    this.wingCommand = { amp: clamp(this.power / 0.35, 0, 1), fold: this.perchBlend * (1 - smoothstep(0.08, 0.3, this.power)) };
    this.applyPose(dt);
    this.poseBrain();
    this.lastVel.copy(this.vel);
  }

  /** A faint random event now and then on a standing fly (see AMBIENT_EVENTS). */
  ambient(dt) {
    if (this.passing.until > this.time) this.seeObject(this.passing.s, this.passing.side);
    this.nextAmbient -= dt;
    if (this.nextAmbient > 0) return;
    this.nextAmbient = AMBIENT_GAP[0] - AMBIENT_GAP[1] * Math.log(1 - Math.random());
    if (this.state !== 'perch') return; // these are things that happen to a fly standing on the glass

    let pick = Math.random() * AMBIENT_TOTAL;
    const event = AMBIENT_EVENTS.find((e) => (pick -= e.w) < 0) ?? AMBIENT_EVENTS[0];
    if (event.dust) {
      this.dust = Math.max(this.dust, rand(...event.dust));
      return;
    }
    const side = Math.random() < 0.5 ? 'L' : 'R';
    const s = rand(...event.s);
    const dur = rand(...event.dur);
    if (event.object) {
      this.passing = { s, side, until: this.time + dur };
    } else {
      for (const [group, base, gain] of event.groups(side, 'fmh'[Math.floor(Math.random() * 3)])) {
        this.addEvent(group, base + gain * s, dur);
      }
    }
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
    if (this.state === 'fly') {
      both('jo_cef', clamp(this.vel.length() * 4.5, 0, 12)); // wind on the antennae
      both('haltere', clamp(this.omega.length() * HALTERE_PER_RAD, 0, 12)); // the body is spinning
    }
    both('haltere', 9 * this.wingAmp * (1 - this.wingFold)); // the halteres feel the wingbeat
    if (env.shake > 0.05) {
      both('haltere', 6 + 6 * Math.min(1, env.shake));
      both('prop_leg_m', 6 + 5 * Math.min(1, env.shake));
    }
    if (this.dust > 0.02) both('bm', DUST[0] + DUST[1] * this.dust);
    if (this.threat.strength > 0.02) put(`looming_${this.threat.side}`, 7.5 + 6 * this.threat.strength);
    this.seen.strength *= Math.exp(-dt / 0.25);
    if (this.seen.strength > 0.02) {
      put(`lc10d_${this.seen.side}`, OBJECT_STEER[0] + OBJECT_STEER[1] * this.seen.strength);
      both('lc9', OBJECT_WALK[0] + OBJECT_WALK[1] * this.seen.strength);
    }
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

    // descending walking commands: DNp09 forward, MDN backward, DNa02 / DNa01 turn to their own side
    const walkWanted = clamp(this.link.both('dn_DNp09') / WALK_HZ, 0, 1) - clamp(r('dn_mdn') / BACK_HZ, 0, 1);
    this.walk += (walkWanted - this.walk) * damp(5, dt);
    const turnWanted = clamp((r('dn_DNa02_L') - r('dn_DNa02_R') + 0.5 * (r('dn_DNa01_L') - r('dn_DNa01_R'))) / TURN_HZ, -1, 1);
    this.turn += (turnWanted - this.turn) * damp(8, dt);

    // grooming: aDN1 / aDN2 (Hampel 2015) drive the front legs to rub; the rubbing wipes the dust off the head
    const groomWanted = clamp(r('dn_groom') / GROOM_HZ, 0, 1);
    this.groom += (groomWanted - this.groom) * damp(groomWanted > this.groom ? 8 : 1.2, dt);
    this.cleanBlend = this.groom * this.perchBlend;
    this.dust = Math.max(0, this.dust - CLEAN_RATE * this.cleanBlend * dt);
    this.jump = clamp(this.link.both('mn_ttm') / TTM_HZ, 0, 1);

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

  // ----- standing, walking, flying, landing ------------------------------------

  updateStand(dt, env) {
    this.walkOn(dt);
    this.stickToSurface();
    this.pullOff(dt, env);
  }

  /** Walking and turning commands move and turn the body on its footing; the feet then step as it is carried along. */
  walkOn(dt) {
    const n = this.perchN;
    this.perchFwd.applyAxisAngle(n, TURN_RATE * this.turn * dt);
    this.perchFwd.addScaledVector(n, -this.perchFwd.dot(n)).normalize();
    this.pos.addScaledVector(this.perchFwd, WALK_MAX * this.walk * dt);
    this.stepLead = this.walk < -0.05 ? -0.03 : 0.03;
  }

  /** Lift the wings give (in weights); the same law in the air and on the glass. */
  get lift() {
    return clamp((this.power - 0.1) / 0.4, 0, 1.15);
  }

  /**
   * Acceleration (units/s^2) away from a surface with outward normal `n`: the wings and the jump muscle push, the weight
   * and the grip of the feet hold. Positive: the body leaves the surface. `up` is the direction against gravity.
   */
  liftoff(n, up) {
    return GRAVITY * (this.lift - n.dot(up)) + JUMP_ACCEL * this.jump ** 2 - ADHESION;
  }

  /**
   * A standing body pushed off the glass gets clear of it and takes off with the speed it has built up on the way
   * (constant acceleration within a frame, so the speed does not depend on the frame rate).
   */
  pullOff(dt, env) {
    _up.copy(env.gravity).negate().normalize();
    const a = this.liftoff(this.perchN, _up);
    const v = this.gapV + a * dt;
    const gap = this.gap + 0.5 * (this.gapV + v) * dt;
    if (gap > LIFTOFF_GAP) {
      this.takeOff(Math.sqrt(Math.max(0, this.gapV * this.gapV + 2 * a * (LIFTOFF_GAP - this.gap))));
    } else if (gap < 0) {
      this.gap = this.gapV = 0; // the weight presses it back down
    } else {
      this.gap = gap;
      this.gapV = v;
    }
  }

  takeOff(speed) {
    if (!this.useBrain) return super.takeOff(); // the scripted fly calls this when it has sat long enough
    this.state = 'fly';
    this.stateT = 0;
    this.heading.copy(this.perchFwd);
    if (this.perchKind === 'wall') this.heading.addScaledVector(this.perchN, 0.6).normalize();
    this.vel.copy(this.perchN).multiplyScalar(speed).addScaledVector(this.perchFwd, WALK_MAX * this.walk);
  }

  updateAir(dt, env) {
    _up.copy(env.gravity).negate().normalize();
    const powered = smoothstep(0.08, 0.3, this.power);
    // steering: rotate the heading about the up axis
    this.heading.applyAxisAngle(_up, YAW_GAIN * this.steer * powered * dt);
    this.heading.addScaledVector(_up, -this.heading.dot(_up)).normalize();

    const lift = this.lift;
    const cruise = V_MAX * clamp(this.power / 0.7, 0, 1);
    // horizontal: wing thrust relaxes the velocity towards heading * cruise; with idle wings only air drag acts
    // (a knocked fly is a ballistic body). Vertical: lift against gravity
    const vUp = this.vel.dot(_up);
    _v.copy(this.vel).addScaledVector(_up, -vUp);
    _h.copy(this.heading).multiplyScalar(cruise);
    this.vel.addScaledVector(_h.sub(_v), damp(AIR_DRAG + (3 - AIR_DRAG) * powered, dt));
    const ay = (lift - 1) * GRAVITY - 0.9 * vUp;
    this.vel.addScaledVector(_up, ay * dt);
    if (env.shake > 0.05) this.vel.addScaledVector(randomUnit(_h), env.shake * SHAKE_ACCEL * dt); // the jar throws it about
    this.vel.clampLength(0, 6);
    this.pos.addScaledVector(this.vel, dt);

    const impact = this.collide(0.45, AIR_CLEAR, FLOOR_REST - 0.02, 2.5);
    if (impact > 0.6) this.omega.addScaledVector(randomUnit(_h), impact * 2); // a knock off the centre of mass spins the body
    if (impact > 0.7) this.crash(impact);

    const r = Math.hypot(this.pos.x, this.pos.z);
    const wallR = innerRadiusAt(this.pos.y) - AIR_CLEAR;
    const onFloor = this.pos.y <= FLOOR_REST + 0.03;
    const onWall = r >= wallR - 0.02 && this.pos.y > 0.4 && this.pos.y < 2.15;
    if (onFloor || onWall) this.omega.multiplyScalar(Math.exp(-3 * dt)); // rubbing on the glass calms the spin
    if (onFloor) {
      this.vel.x *= Math.exp(-4 * dt); // and slows the slide
      this.vel.z *= Math.exp(-4 * dt);
    }
    // it settles on the glass it touches once it has stopped moving and spinning, unless what the wings and the jump
    // muscle still give would push it off again; before that it is a tumbling body
    if (this.vel.length() < 1.6 && this.omega.length() < SETTLE_SPIN) {
      if (onFloor && this.liftoff(_n.set(0, 1, 0), _up) <= 0) this.beginStand('floor', this.pos);
      else if (onWall && this.liftoff(_n.set(-this.pos.x, 0, -this.pos.z).normalize(), _up) <= 0) this.beginStand('wall', this.pos);
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
    this.omega.set(0, 0, 0);
    this.gap = this.gapV = 0;
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

  // ----- pose ---------------------------------------------------------------

  /**
   * In the air the body is free to spin. The wingbeat (with the halteres and the steering muscles behind it)
   * holds it upright and on its heading; with idle wings a knock just makes it tumble, and drag slowly calms the spin.
   */
  holdAttitude(dt, target) {
    if (!this.useBrain) return super.holdAttitude(dt, target);
    const held = smoothstep(0.08, 0.3, this.power);
    const w = this.omega.length();
    if (w > 1e-3) {
      _qs.setFromAxisAngle(_h.copy(this.omega).multiplyScalar(1 / w), w * dt);
      this.quat.premultiply(_qs).normalize();
    }
    this.omega.multiplyScalar(Math.exp(-(0.9 + 4 * held) * dt));
    this.quat.slerp(target, damp(13 * held, dt));
  }

  updateBuzz() {
    super.updateBuzz();
    if (!this.useBrain) return;
    this.buzz = clamp(0.1 + this.power, 0, 1) * clamp(2 * this.wingAmp * (1 - this.wingFold), 0, 1); // the sound is the wings
    this.buzzSpeed = clamp(0.2 + this.power * 0.6, 0, 1);
  }

  /** Head, abdomen and proboscis follow their motor pools. */
  poseBrain() {
    if (!this.useBrain) return;
    const m = this.model;
    m.setHead(this.headPitch + this.headNod, this.headYaw); // the head tips down while the front legs rub
    m.bendAbdomen(-0.9 * this.abdCurl);
    m.setProboscis(this.proboscis);
  }
}
