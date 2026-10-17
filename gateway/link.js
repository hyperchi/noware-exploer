// Line-oriented request/reply link over any byte stream.
//
// The transport is injected (a serialport instance in production, a fake in
// tests): it must emit "data" with Buffers and "close"/"error", and expose
// write(string|Buffer, callback). The cube streams one live JSON line a second
// with ESP_LOG noise around it; command replies arrive interleaved, so they are
// matched by shape, as the browser's serial.js does.
import { EventEmitter } from "node:events";
import * as proto from "../public/dashboard/js/protocol.js";

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_LINE_BUFFER = 64 * 1024;
/** A healthy cube drains a 30-byte command in well under a millisecond. */
export const WRITE_STALL_MS = 1500;

export class CubeLink extends EventEmitter {
  constructor(transport, { now = () => Date.now() / 1000, stallMs = WRITE_STALL_MS } = {}) {
    super();
    this.transport = transport;
    this.now = now;
    this.stallMs = stallMs;
    this.isOpen = true;
    this.writeStalled = false;
    this._buffer = "";
    this._pending = [];
    this._onData = (chunk) => this._feed(chunk.toString("utf8"));
    this._onClose = () => this._closed();
    this._onError = (err) => this.emit("error", err);
    transport.on("data", this._onData);
    transport.on("close", this._onClose);
    transport.on("error", this._onError);
  }

  _feed(text) {
    this._buffer += text;
    if (this._buffer.length > MAX_LINE_BUFFER) this._buffer = this._buffer.slice(-MAX_LINE_BUFFER);
    let index;
    while ((index = this._buffer.indexOf("\n")) >= 0) {
      const line = this._buffer.slice(0, index).replace(/\r$/, "");
      this._buffer = this._buffer.slice(index + 1);
      if (line.trim()) this._handleLine(line);
    }
  }

  _handleLine(line) {
    const data = proto.extractJson(line);
    if (!data) {
      this.emit("log", line);
      return;
    }
    const index = this._pending.findIndex((p) => p.matcher(data));
    if (index >= 0) {
      const [p] = this._pending.splice(index, 1);
      clearTimeout(p.timer);
      p.resolve(data);
      return;
    }
    if (proto.isLive(data)) {
      this.emit("live", proto.parseLive(data, { timestamp: this.now() }));
    } else if (proto.isConfigReply(data)) {
      this.emit("config", proto.parseConfig(data.config));
    }
  }

  _closed() {
    if (!this.isOpen) return;
    this.isOpen = false;
    for (const p of this._pending.splice(0)) {
      clearTimeout(p.timer);
      p.reject(new Error("Serial link closed"));
    }
    this.emit("closed");
  }

  write(text) {
    if (!this.isOpen) return Promise.reject(new Error("Serial link is closed"));
    if (this.writeStalled) return Promise.reject(new Error("Serial link write stalled"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Talk-only firmware never drains the 64-byte USB FIFO; once it is
        // full every write hangs. Stop writing for the rest of this connection.
        this.writeStalled = true;
        this.emit("stalled");
        reject(new Error("Serial link write stalled"));
      }, this.stallMs);
      try {
        this.transport.write(text + "\n", (err) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /** Send a command and wait for the reply its matcher accepts. */
  send(command, matcher, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const entry = { matcher, resolve, reject, timer: 0 };
      entry.timer = setTimeout(() => {
        const index = this._pending.indexOf(entry);
        if (index >= 0) this._pending.splice(index, 1);
        reject(new Error(`Timed out waiting for a reply to ${command}`));
      }, timeoutMs);
      this._pending.push(entry);
      this.write(command).catch((err) => {
        clearTimeout(entry.timer);
        const index = this._pending.indexOf(entry);
        if (index >= 0) this._pending.splice(index, 1);
        reject(err);
      });
    });
  }

  close() {
    this.transport.off("data", this._onData);
    this.transport.off("close", this._onClose);
    this.transport.off("error", this._onError);
    this._closed();
  }
}
