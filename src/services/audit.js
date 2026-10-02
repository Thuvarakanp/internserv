import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Append-only record of who did what. Kept in memory for the UI and mirrored
// to a JSONL file so it survives restarts.
export class AuditLog {
  #entries = []; #file; #now;
  constructor({ file = null, now = Date.now, max = 500 } = {}) {
    this.#file = file; this.#now = now; this.max = max;
  }

  record(entry) {
    const e = { at: new Date(this.#now()).toISOString(), ...entry };
    this.#entries.unshift(e);
    if (this.#entries.length > this.max) this.#entries.pop();
    if (this.#file) {
      mkdir(dirname(this.#file), { recursive: true })
        .then(() => appendFile(this.#file, JSON.stringify(e) + '\n'))
        .catch((err) => console.error('audit write failed:', err.message));
    }
    return e;
  }

  list(limit = 100) { return this.#entries.slice(0, limit); }
}
