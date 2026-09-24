// All sounds are synthesised with WebAudio: no audio assets to ship.

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

export class Sound {
  constructor() {
    this.enabled = false;
    this.volume = 0.6;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // --- Buzz: detuned saws + a square, low-passed, amplitude-modulated by the wingbeat.
    this.buzzGain = ctx.createGain();
    this.buzzGain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.buzzGain.connect(this.pan).connect(this.master);

    this.tremolo = ctx.createGain();
    this.tremolo.gain.value = 0.7;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1100;
    this.filter.Q.value = 0.9;
    this.filter.connect(this.tremolo).connect(this.buzzGain);

    this.buzzOscs = [
      ['sawtooth', 1, 0.5],
      ['square', 1.012, 0.28],
      ['sawtooth', 2.003, 0.22],
    ].map(([type, ratio, gain]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(this.filter);
      osc.start();
      return { osc, ratio };
    });

    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 33;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;
    this.lfo.connect(lfoDepth).connect(this.tremolo.gain);
    this.lfo.start();

    // A little breathy noise on top makes it sound less like a synth.
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1300;
    band.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.07;
    noise.connect(band).connect(noiseGain).connect(this.filter);
    noise.start();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    if (on && this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  /** Call once per frame. buzz 0..1 = wing activity, speed 0..1, pan -1..1, depth: +1 = towards the viewer. */
  update({ buzz, speed, pan, depth }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this.buzzGain.gain.setTargetAtTime(buzz * 0.32, t, 0.07);
    const f0 = (165 + speed * 95) * (1 + clamp(depth, -1, 1) * 0.05);
    for (const { osc, ratio } of this.buzzOscs) osc.frequency.setTargetAtTime(f0 * ratio, t, 0.05);
    this.filter.frequency.setTargetAtTime(650 + speed * 900 + (depth + 1) * 250, t, 0.08);
    this.lfo.frequency.setTargetAtTime(28 + speed * 12, t, 0.1);
    this.pan.pan.setTargetAtTime(clamp(pan, -1, 1) * 0.75, t, 0.05);
  }

  /** Silence the buzz at once (the window stopped being painted, so nothing will update it). */
  silence() {
    if (!this.ctx) return;
    this.buzzGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.buzzGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
  }

  /** Glass "ting": a few inharmonic partials with fast decays. */
  ting(strength = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = 1500 + Math.random() * 500;
    [[1, 1], [1.59, 0.55], [2.32, 0.35], [3.1, 0.2]].forEach(([ratio, amp], i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * ratio;
      const g = ctx.createGain();
      const decay = 0.5 / (1 + i * 0.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16 * amp * strength, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    });
    this.click(0.05 * strength, 4000);
  }

  /** The fly bumping into the glass: a dry little tick. */
  tick(strength = 0.5) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2300 + Math.random() * 600, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * strength, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.09);
    this.click(0.06 * strength, 3000);
  }

  /** Dull knock for a fly that has been poked and tossed. */
  thud() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  click(level, highpass) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = highpass;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, 0.05);
  }
}
