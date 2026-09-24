'use strict';

// Runs the connectome simulator (brain/, see brain/main.cpp) as a child process and speaks its
// line protocol. Requests are pipelined; the sidecar answers each command with one line, in order.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data', 'brain');
const FILES = {
  binary: path.join(DATA, 'brain'),
  graph: path.join(DATA, 'graph.bin'),
  groups: path.join(DATA, 'groups.txt'),
};

/** Is the connectome set up? (tools/setup_brain.sh builds it.) */
function available() {
  return Object.values(FILES).every((f) => fs.existsSync(f));
}

class BrainHost {
  constructor() {
    this.proc = null;
    this.waiting = []; // resolvers for the responses still owed, oldest first
    this.buffer = '';
    this.names = [];
    this.sizes = {};
    this.drives = new Map(); // last drive sent per group, so only changes cost a command
    this.ready = false;
    this.pending = false; // a step is in flight
  }

  start() {
    return new Promise((resolve, reject) => {
      const proc = spawn(FILES.binary, ['--graph', FILES.graph, '--groups', FILES.groups], { stdio: ['pipe', 'pipe', 'inherit'] });
      this.proc = proc;
      proc.on('error', reject);
      proc.on('exit', () => {
        this.ready = false;
        for (const w of this.waiting.splice(0)) w.reject(new Error('brain exited'));
      });
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => this.onData(chunk));
      // the first line is READY, before any command
      this.waiting.push({
        resolve: async (line) => {
          const parts = line.split(' ');
          if (parts[0] !== 'READY') return reject(new Error(`unexpected greeting: ${line}`));
          const groups = (await this.send('groups')).split(' ');
          const count = Number(groups[1]);
          this.names = [];
          for (let i = 0; i < count; i++) {
            this.names.push(groups[2 + i * 2]);
            this.sizes[groups[2 + i * 2]] = Number(groups[3 + i * 2]);
          }
          this.ready = true;
          resolve({ backend: parts[1], neurons: Number(parts[2]), connections: Number(parts[3]), groups: this.names, sizes: this.sizes });
        },
        reject,
      });
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      this.waiting.shift()?.resolve(line);
    }
  }

  send(line) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.proc.stdin.write(`${line}\n`);
    });
  }

  /**
   * Set the tonic drive (mV) of groups, advance the simulation by `ms`, and return the spike
   * counts of every group. Groups missing from `drives` are released.
   */
  async step(drives, ms) {
    if (!this.ready) throw new Error('brain not ready');
    const commands = [];
    for (const [name, value] of this.drives) {
      if (!(name in drives) || drives[name] === 0) {
        commands.push(`drive ${name} 0`);
        this.drives.delete(name);
      }
    }
    for (const [name, value] of Object.entries(drives)) {
      if (value === 0 || !(name in this.sizes)) continue;
      if (this.drives.get(name) !== value) {
        commands.push(`drive ${name} ${value}`);
        this.drives.set(name, value);
      }
    }
    commands.push(`advance ${ms}`);
    const replies = commands.map((c) => this.send(c));
    const last = (await Promise.all(replies)).pop().split(' ');
    const counts = {};
    for (let i = 0; i < this.names.length; i++) counts[this.names[i]] = Number(last[2 + i]);
    return counts;
  }

  /** Persistent Poisson input (Hz per neuron) on groups: the fly's ever-present sensory noise. */
  async noise(groups, rate) {
    await Promise.all(groups.filter((g) => g in this.sizes).map((g) => this.send(`poisson ${g} ${rate}`)));
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.stdin.write('quit\n');
      } catch {
        /* already gone */
      }
      setTimeout(() => this.proc?.kill(), 500).unref();
    }
    this.ready = false;
  }
}

module.exports = { BrainHost, available, FILES };
