/* Share-with-contractor payloads: a concise structured story, not a dump of
 * readings. Used by the "Ask my contractor" action and the air report.
 */

import { CHANNEL_INFO, formatValue } from './thresholds.js';
import { formatDuration } from './status.js';
import { equipmentLabels } from './household.js';

function similarCount(patterns, category, days) {
  const p = patterns?.byCategory?.[category];
  return p ? p.count : 0;
}

/**
 * Context automatically attached to a contractor contact request.
 * @param {object} o
 * @param {'message'|'call'|'request_service'|'schedule'|'share_air_report'} o.type
 * @param {object} o.summary  AirIntelligenceSummary for the room
 * @param {object} [o.event]  the issue being escalated (public event)
 * @param {object} o.household
 * @param {object} [o.room]
 * @param {{name?:string,email?:string}} [o.homeowner]
 * @param {object} [o.contractor]
 * @param {number} o.now
 */
export function buildContactPayload({ type, summary, event, household, room, homeowner, contractor, now }) {
  const issue = event || (summary.primaryIssue ? summary.activeEvents.find((e) => e.id === summary.primaryIssue.eventId) : null);
  const measurement = issue ? summary.primaryIssue?.measurement || issue.measurement : null;
  const tried = issue ? (issue.acknowledgedActions || []).map((a) => a.title) : [];
  const trend = issue?.recovery?.text || (issue ? 'No change recorded yet' : null);
  const patterns = summary.patterns;
  const category = issue?.category || null;
  return {
    type,
    contractorId: contractor?.id || null,
    householdId: household?.id || summary.householdId,
    issueId: issue?.id || null,
    createdAt: now,
    homeowner: { name: homeowner?.name || household?.name || '', email: homeowner?.email || '' },
    room: room?.name || summary.roomName || '',
    issue: issue ? `${issue.severity === 'unhealthy' || issue.durationMinutes > 45 ? 'Persistent ' : ''}${CHANNEL_INFO[issue.channel].friendly.toLowerCase()}${issue.category === 'ventilation' ? ' running low' : ' elevated'}` : 'No active issue',
    startedAt: issue?.startedAt || null,
    current: measurement ? `${measurement.technical} ${measurement.text}` : null,
    normal: measurement?.baselineText || null,
    duration: issue ? formatDuration((issue.durationMinutes || 0) * 60) : null,
    actionsTried: tried,
    trend,
    likelyCategory: issue ? `${issue.category}${issue.hypothesis && issue.hypothesis.source !== 'unknown' ? ` / ${issue.hypothesis.label.toLowerCase()} (${issue.hypothesis.confidence.level} confidence)` : ' / cause unclear'}` : null,
    supportingHistory: category ? `${similarCount(patterns, category)} similar events in the last ${patterns?.windowDays || 30} days` : `${patterns?.totalEvents || 0} events in the last ${patterns?.windowDays || 30} days`,
    equipment: equipmentLabels(household),
    deviceHealth: `${summary.deviceHealth.label}${summary.deviceHealth.simulated ? ' (simulated data)' : ''}`,
    simulated: summary.deviceHealth.simulated,
    insights: (summary.contractorInsights || []).map((i) => ({ category: i.category, problem: i.problem, confidence: i.confidence.level })),
  };
}

/** A full but concise air report for the household (or one room). */
export function buildAirReport({ summaries, household, contractor, serviceEvents = [], now }) {
  const rooms = summaries.map((s) => ({
    room: s.roomName,
    status: s.currentStatus.label,
    live: s.currentStatus.live,
    simulated: s.deviceHealth.simulated,
    device: `${s.deviceHealth.label}${s.deviceHealth.fwVersion ? ` · fw ${s.deviceHealth.fwVersion}` : ''}`,
    readings: s.measurements.map((m) => ({ what: m.friendly, metric: m.technical, value: m.text, band: m.bandLabel, normal: m.baseline?.text || '' })),
    activeIssues: s.activeEvents.map((e) => ({ what: e.headline, since: e.startedAt, measurement: e.measurement?.text, likely: e.hypothesis?.label, confidence: e.hypothesis?.confidence.level, tried: (e.acknowledgedActions || []).map((a) => a.title), improving: e.recovery?.text })),
    last30Days: Object.fromEntries(Object.entries(s.patterns.byCategory).filter(([, v]) => v.count).map(([k, v]) => [k, { events: v.count, longerThan30Min: v.longCount, medianRecoveryMin: v.medianRecoveryMin != null ? Math.round(v.medianRecoveryMin) : null }])),
    overnightVentilation: s.patterns.overnightVentilation,
    insights: s.contractorInsights.map((i) => ({ category: i.category, problem: i.problem, evidence: i.evidence.map((e) => e.text), possibleSolutions: i.potentialSolutions, requiresProfessionalDiagnosis: i.requiresProfessionalDiagnosis })),
  }));
  return {
    generatedAt: now,
    household: { id: household?.id, name: household?.name, concerns: household?.profile?.concerns || {}, sensitivities: household?.profile?.sensitivities || {}, pets: household?.profile?.pets || {} },
    contractor: contractor ? { id: contractor.id, name: contractor.name } : null,
    equipment: (household?.equipment || []).map((e) => ({ type: e.type, label: e.label, installedAt: e.installedAt || null })),
    serviceHistory: serviceEvents.map((s) => ({ type: s.type, at: s.occurredAt, equipment: s.equipment?.label || null, notes: s.notes || '' })),
    rooms,
    note: 'Summarised by the AirCube air-intelligence engine. Values marked simulated come from a scenario, not a sensor. Environmental guidance only, not medical advice.',
  };
}

export function formatReadingLine(m) {
  return `${m.friendly}: ${m.text} (${m.technical}) · ${m.bandLabel}${m.baseline ? ` · ${m.baseline.text}` : ''}`;
}

export { formatValue };
