// Renderer side of the connectome brain: sends sensory drives every frame, keeps the latest
// motor read-outs. The simulation itself runs in a sidecar process (brain/), see brain-host.js.

const SMOOTH_MS = 30; // read-outs are low-passed a little: spike counts in one 16 ms frame are noisy

export class BrainLink {
  constructor() {
    this.ready = false;
    this.sizes = {};
    this.rates = {}; // Hz per neuron, low-passed
    this.busy = false;
    this.pendingMs = 0;
    this.simMs = 0; // simulated milliseconds so far
    this.neurons = 0;
    this.connections = 0;
  }

  /** `resting` is the drive of a fly standing quietly; the network is settled in it before use. */
  async init(resting = {}) {
    const info = await window.widget.brainInfo();
    if (!info) return false;
    this.sizes = info.sizes;
    this.neurons = info.neurons;
    this.connections = info.connections;
    // Switching every sensory group on at once from silence makes a violent transient that a real
    // fly never has: let the network settle first (a couple of simulated seconds).
    await window.widget.brainStep(resting, 2500);
    await window.widget.brainStep(resting, 500);
    this.rates = {};
    this.ready = true;
    return true;
  }

  stop() {
    this.ready = false;
  }

  /** Call every frame with the current drives (mV per group) and the elapsed time. */
  update(drives, dtMs) {
    this.pendingMs += dtMs;
    if (!this.ready || this.busy) return;
    const ms = Math.min(this.pendingMs, 50);
    this.pendingMs = 0;
    this.busy = true;
    window.widget
      .brainStep(drives, ms)
      .then((counts) => {
        if (counts) this.ingest(counts, ms);
        else this.ready = false; // the sidecar went away
      })
      .catch(() => {
        this.ready = false;
      })
      .finally(() => {
        this.busy = false;
      });
  }

  ingest(counts, ms) {
    this.simMs += ms;
    const k = 1 - Math.exp(-ms / SMOOTH_MS);
    for (const [name, n] of Object.entries(counts)) {
      const hz = n / this.sizes[name] / (ms / 1000);
      this.rates[name] = (this.rates[name] ?? 0) + (hz - (this.rates[name] ?? 0)) * k;
    }
  }

  rate(name) {
    return this.rates[name] ?? 0;
  }

  /** Mean of the left and right pools. */
  both(prefix) {
    return (this.rate(`${prefix}_L`) + this.rate(`${prefix}_R`)) / 2;
  }
}
