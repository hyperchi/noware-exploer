// One line per event, timestamped, machine-greppable. Errors never throw.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = "info", sink = (line) => process.stdout.write(line + "\n")) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const emit = (name, message, fields) => {
    if (LEVELS[name] < threshold) return;
    const extra = fields && Object.keys(fields).length ? " " + safeJson(fields) : "";
    try {
      sink(`${new Date().toISOString()} ${name.toUpperCase().padEnd(5)} ${message}${extra}`);
    } catch {
      /* a broken stdout must not take the collector down */
    }
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value, (key, v) => (v instanceof Error ? { message: v.message, code: v.code } : v));
  } catch {
    return String(value);
  }
}
