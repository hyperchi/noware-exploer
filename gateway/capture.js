// Local capture: one JSON line per reading in a daily file, kept for N days.
// The line is exactly the parseLive object (with `source: "physical"`), so a
// capture can be replayed through the same parser-independent pipeline later.
import fs from "node:fs";
import path from "node:path";

const FILE_PATTERN = /^readings-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export function dayKey(timestampS) {
  return new Date(timestampS * 1000).toISOString().slice(0, 10);
}

export class Capture {
  constructor(dir, { days = 14, log, now = () => Date.now() / 1000 } = {}) {
    this.dir = dir;
    this.days = days;
    this.log = log;
    this.now = now;
    this.currentDay = "";
    this.stream = null;
    this.written = 0;
    this.lastError = "";
  }

  fileFor(day) {
    return path.join(this.dir, `readings-${day}.jsonl`);
  }

  append(reading) {
    try {
      const day = dayKey(reading.timestamp || this.now());
      if (day !== this.currentDay || !this.stream) this._rotate(day);
      this.stream.write(JSON.stringify(reading) + "\n");
      this.written++;
      this.lastError = "";
    } catch (err) {
      if (this.lastError !== err.message) this.log?.error("capture write failed", { error: err.message });
      this.lastError = err.message;
    }
  }

  _rotate(day) {
    this.stream?.end();
    fs.mkdirSync(this.dir, { recursive: true });
    this.stream = fs.createWriteStream(this.fileFor(day), { flags: "a" });
    this.stream.on("error", (err) => {
      this.lastError = err.message;
      this.log?.error("capture stream error", { error: err.message });
    });
    this.currentDay = day;
    this.prune();
  }

  /** Delete capture files older than `days` days. Returns the removed names. */
  prune() {
    if (!this.days) return [];
    const cutoff = dayKey(this.now() - this.days * 86400);
    const removed = [];
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return removed;
    }
    for (const name of names) {
      const match = FILE_PATTERN.exec(name);
      if (match && match[1] < cutoff) {
        try {
          fs.unlinkSync(path.join(this.dir, name));
          removed.push(name);
        } catch (err) {
          this.log?.warn("capture prune failed", { name, error: err.message });
        }
      }
    }
    if (removed.length) this.log?.info("capture pruned", { removed });
    return removed;
  }

  close() {
    this.stream?.end();
    this.stream = null;
  }
}
