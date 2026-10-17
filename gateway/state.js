// Small persisted state: a stable publisher id so a restart keeps the relay
// slot instead of looking like a second machine.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function loadState(stateDir) {
  const file = path.join(stateDir, "state.json");
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    /* first run */
  }
  if (typeof state.publisherId !== "string" || state.publisherId.length < 8 || state.publisherId.length > 64) {
    state.publisherId = `gateway-${crypto.randomUUID()}`;
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    } catch {
      /* read-only location: the id lives for this process only */
    }
  }
  return state;
}
