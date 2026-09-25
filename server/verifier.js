'use strict';
// Replay verification runs the physics for the whole run (~200ms CPU per minute of play),
// so it happens on worker threads to keep the HTTP server responsive.
const { Worker, isMainThread, parentPort } = require('node:worker_threads');

if (!isMainThread) {
  const { loadSim, verifyReplay } = require('./sim');
  const RTB = loadSim();
  parentPort.on('message', ({ id, code }) => {
    try { parentPort.postMessage({ id, ok: true, result: verifyReplay(RTB, code) }); }
    catch (e) { parentPort.postMessage({ id, ok: false, error: String(e.message || e) }); }
  });
} else {
  class VerifierPool {
    constructor(size = 1) {
      this.jobs = new Map(); this.queue = []; this.nextId = 1;
      this.workers = Array.from({ length: Math.max(1, size) }, () => this._spawn());
    }
    _spawn() {
      const w = new Worker(__filename);
      w.busy = null;
      w.on('message', (m) => {
        const job = this.jobs.get(m.id); this.jobs.delete(m.id); w.busy = null;
        if (job) m.ok ? job.resolve(m.result) : job.reject(new Error(m.error));
        this._pump();
      });
      w.on('error', (err) => {
        if (w.busy) { const job = this.jobs.get(w.busy); this.jobs.delete(w.busy); if (job) job.reject(err); }
        this.workers[this.workers.indexOf(w)] = this._spawn();
        this._pump();
      });
      return w;
    }
    _pump() {
      for (const w of this.workers) {
        if (w.busy || !this.queue.length) continue;
        const id = this.queue.shift(); w.busy = id;
        w.postMessage({ id, code: this.jobs.get(id).code });
      }
    }
    verify(code) {
      if (this.queue.length > 200) return Promise.reject(new Error('server busy, try again shortly'));
      return new Promise((resolve, reject) => {
        const id = this.nextId++;
        this.jobs.set(id, { code, resolve, reject }); this.queue.push(id); this._pump();
      });
    }
    close() { return Promise.all(this.workers.map((w) => w.terminate())); }
  }
  module.exports = { VerifierPool };
}
