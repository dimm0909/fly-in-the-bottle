const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

/**
 * Rigid-body-ish motion of the jar as a whole.
 *  - pitch/roll: lightly damped springs, so the jar wobbles back upright after a shove
 *  - yaw: spins freely and slowly loses speed
 *  - shake: how violently the jar is being thrown around right now (drives the fly)
 */
export class JarMotion {
  constructor() {
    this.yaw = 0.35;
    this.yawVel = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.roll = 0;
    this.rollVel = 0;
    this.shake = 0;
    this.burst = 0; // extra shake energy from moving the whole window
    this.grabbed = false; // yaw is being driven by the pointer
  }

  /** Shove the tilt springs (rad/s). */
  kick(pitchVel, rollVel) {
    this.pitchVel += pitchVel;
    this.rollVel += rollVel;
  }

  /** The window was jerked: dvx/dvy are the changes in its screen velocity (px/s). */
  jerk(dvx, dvy) {
    this.rollVel += -dvx * 0.0007;
    this.pitchVel += dvy * 0.0004;
    // Dead band: per-frame timing noise while dragging must not count as shaking.
    this.burst = Math.min(this.burst + Math.max(0, Math.hypot(dvx, dvy) - 400) / 2600, 4);
  }

  update(dt) {
    const k = 62;
    const c = 2.3;
    this.pitchVel += (-k * this.pitch - c * this.pitchVel) * dt;
    this.rollVel += (-k * this.roll - c * this.rollVel) * dt;
    this.pitch = clamp(this.pitch + this.pitchVel * dt, -0.38, 0.38);
    this.roll = clamp(this.roll + this.rollVel * dt, -0.38, 0.38);

    // While grabbed the pointer moves the yaw directly; the velocity is only
    // kept so that letting go flings the jar at the speed of the flick.
    this.yawVel *= Math.exp(-(this.grabbed ? 12 : 0.95) * dt);
    if (!this.grabbed) this.yaw += this.yawVel * dt;

    this.burst *= Math.exp(-5 * dt);
    const raw =
      (Math.abs(this.pitchVel) + Math.abs(this.rollVel)) * 0.5 + Math.abs(this.yawVel) * 0.03 + this.burst - 0.55;
    const target = Math.max(0, raw);
    // Fast attack, slow release so a single flick still registers for a few frames.
    this.shake += (target - this.shake) * (1 - Math.exp(-(target > this.shake ? 30 : 4) * dt));
  }
}
