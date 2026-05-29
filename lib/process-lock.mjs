import fs from 'fs';
import path from 'path';

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export class ProcessLock {
  constructor(dbDir) {
    this.lockFile = path.join(dbDir, '.vmap.lock');
    this.held = false;
  }

  async acquire(timeoutMs = 30000) {
    if (this.held) return; // reentrant within same instance
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        fs.writeFileSync(this.lockFile, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
        this.held = true;
        return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        // Check if we (same process) already hold it via another instance
        try {
          const { pid } = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
          if (pid === process.pid) { this.held = true; this._ownedExternally = true; return; }
          if (Date.now() - start > 1000 && !isProcessAlive(pid)) {
            fs.unlinkSync(this.lockFile); continue;
          }
        } catch { try { fs.unlinkSync(this.lockFile); } catch {} continue; }
        await new Promise(r => setTimeout(r, 200));
      }
    }
    throw new Error(`Lock timeout: ${this.lockFile}`);
  }

  release() {
    if (this.held && !this._ownedExternally) {
      try { fs.unlinkSync(this.lockFile); } catch {}
    }
    this.held = false;
    this._ownedExternally = false;
  }
}
