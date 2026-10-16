/* Public surface of the air-intelligence engine. */
export * from './types.js';
export { CHANNEL_INFO, CATEGORY_CHANNELS, bandIndex, bandStatus, bandLabel, goodTop, goodBottom, formatValue } from './thresholds.js';
export { normalizeReading, normalizeSlot, mergeSamples } from './normalize.js';
export { emptyCapabilities, capabilitiesFromReading, capabilitiesFromReadings, availableChannels, describeCapabilities } from './capabilities.js';
export { computeBaselines, baselineAt, elevatedLine, recoveredLine, lowLine, localHour, localDayKey, BUCKETS } from './baseline.js';
export { extractFeatures, crossFeatures } from './features.js';
export { detectEvents, describeChanges, eventId } from './events.js';
export { inferSource } from './infer-source.js';
export { recommend } from './recommendations.js';
export { overallStatus, formatDuration } from './status.js';
export { deviceHealth, formatAge, ONLINE_WINDOW_S, STALE_WINDOW_S } from './health.js';
export { confidenceLevel, CONFIDENCE_LABEL } from './confidence.js';
export { analyzePatterns, compareAroundService } from './patterns.js';
export { contractorInsights, opportunitySignals, escalationFor, ESCALATION } from './contractor.js';
export { measurementRows, recoveryState, buildTimeline, homeSummary, serviceTitle } from './summary.js';
export { buildContactPayload, buildAirReport } from './report.js';
export { defaultProfile, mergeProfile, roomOfDevice, hasEquipment, personalNotes, isMealtime, isNight } from './household.js';
export { unavailableOutdoor, NoOutdoorProvider, StaticOutdoorProvider, outdoorCleanerThanIndoors, outdoorPollutionHigh } from './outdoor.js';
export { RoomEngine, publicEvent, issueCard } from './engine.js';
export { SCENARIOS, SCENARIO_KEYS, CAPABILITY_PRESETS, generateReadings, readingAt, generateHistorySlots, historyProgram, scenarioStartTime, scenarioServiceEvents, rng, vocLevelFromTvoc } from './scenarios.js';

export { notificationIntents } from './notifications.js';
