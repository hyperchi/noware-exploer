// Notification intents only. Delivery belongs to a future adapter, and ids
// provide a deduplication key so polling cannot notify for every sample.
export function notificationIntents(summary) {
  if (summary.deviceHealth.state !== 'online') return [];
  const common = { householdId: summary.householdId, roomId: summary.roomId, source: summary.source, simulated: summary.deviceHealth.simulated };
  const out = summary.activeEvents.map(e => ({ ...common, id: `air:${e.id}`, audience: 'homeowner', kind: 'air_event', eventId: e.id, title: e.headline, body: `${e.measurement?.technical || ''} ${e.measurement?.text || ''}. ${e.recommendations?.[0]?.title || 'Monitor the air.'}`, confidence: e.hypothesis?.confidence.level || 'low' }));
  for (const e of summary.recentEvents) out.push({ ...common, id: `resolved:${e.id}`, audience: 'homeowner', kind: 'resolved', eventId: e.id, title: 'Air is back to normal', body: e.recoveryMinutes == null ? 'Levels returned to their usual range.' : `Levels returned to their usual range in ${Math.round(e.recoveryMinutes)} minutes after the peak.` });
  for (const s of summary.opportunitySignals.filter(s => s.status === 'new')) out.push({ ...common, id: `review:${s.id}`, audience: 'contractor', kind: 'recurring_pattern', signalId: s.id, title: 'Recurring air pattern to review', body: s.evidence.map(e => e.text).join(' '), confidence: s.confidence.level, requiresSharingConsent: true });
  return out;
}
