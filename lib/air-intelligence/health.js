/* Device health: online, warming up, stale, offline, fault.
 *
 * The air verdict is only ever drawn from a device that is live. Stale data is
 * reported as stale, never as the current state of the air.
 */

export const ONLINE_WINDOW_S = 20;
export const STALE_WINDOW_S = 15 * 60;
export const WARMUP_EXPECTED_S = 180;

/**
 * @param {object} input
 * @param {number} [input.lastReadingAt] unix seconds of the newest reading
 * @param {number} [input.lastHeartbeatAt] unix seconds the publisher was last heard
 * @param {boolean} [input.connected] transport-level connection state, if known
 * @param {boolean} [input.warmingUp] newest reading says the gas sensor is conditioning
 * @param {boolean} [input.fault] newest reading flags a missing sensor
 * @param {'physical'|'simulated'|'replay'} [input.source]
 * @param {number} [input.uptimeMs] device uptime from the newest reading
 * @param {number} input.now
 */
export function deviceHealth({ lastReadingAt = 0, lastHeartbeatAt = 0, connected, warmingUp = false, fault = false, source = 'physical', uptimeMs = 0, now }) {
  const age = lastReadingAt ? now - lastReadingAt : Infinity;
  let state;
  if (!lastReadingAt) state = connected ? 'warming_up' : 'no_device';
  else if (age > STALE_WINDOW_S || connected === false && age > ONLINE_WINDOW_S) state = 'offline';
  else if (age > ONLINE_WINDOW_S) state = 'stale';
  else if (fault) state = 'fault';
  else if (warmingUp) state = 'warming_up';
  else state = 'online';

  const live = state === 'online' || state === 'warming_up' || state === 'fault';
  const ageText = formatAge(age);
  const labels = {
    online: { label: 'Online', detail: `reading ${ageText}` },
    warming_up: { label: 'Warming up', detail: lastReadingAt ? `Readings are stabilizing. Usually takes about ${Math.round(WARMUP_EXPECTED_S / 60)} minutes.` : 'Waiting for the first reading.' },
    stale: { label: 'Not updating', detail: `last reading ${ageText}` },
    offline: { label: 'Offline', detail: lastReadingAt ? `last reading ${ageText}` : 'no readings yet' },
    fault: { label: 'Sensor fault', detail: 'The device reports a missing or failed sensor. Readings from that sensor are withheld.' },
    no_device: { label: 'No device', detail: 'Connect an AirCube or start a simulation.' },
  };
  return {
    state,
    live,
    ...labels[state],
    lastReadingAt,
    lastHeartbeatAt,
    ageS: Number.isFinite(age) ? age : null,
    source,
    simulated: source !== 'physical',
    warmupRemainingS: state === 'warming_up' && uptimeMs ? Math.max(0, WARMUP_EXPECTED_S - uptimeMs / 1000) : null,
  };
}

export function formatAge(seconds) {
  if (!Number.isFinite(seconds)) return 'never';
  if (seconds < 5) return 'just now';
  if (seconds < 90) return `${Math.round(seconds)} sec ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}
