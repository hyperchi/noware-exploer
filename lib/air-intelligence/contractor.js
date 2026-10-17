/* Contractor intelligence: recurring, measured problems with reasonable
 * professional responses, and the escalation rules the homeowner view shares.
 *
 * Guardrails: an insight needs real coverage and a real pattern, a single
 * cooking event is never a lead, missing data never counts as evidence, and
 * every insight separates "observed issue" from "possible solution" with
 * requiresProfessionalDiagnosis set honestly.
 */

import { confidenceLevel, evidence as ev, round2 } from './confidence.js';
import { hasEquipment } from './household.js';
import { formatValue } from './thresholds.js';

export const ESCALATION = Object.freeze({
  particlesEvents30d: 8,
  particlesLongShare: 0.4,
  particlesMedianRecoveryMin: 35,
  vocEvents30d: 12,
  nightsShare: 0.5,
  nightsMin: 5,
  humidityShareAbove60: 0.3,
  humidityShareAbove70: 0.1,
  persistentMinutes: 45,
  minCoverageDays: 3,
});

/**
 * Should a homeowner recommendation include a contractor step for this
 * category right now? Returns {eligible, reasons[]} and never fabricates
 * urgency: a persistent event only counts when a DIY action was already
 * acknowledged and did not help.
 */
export function escalationFor({ category, patterns, event, now }) {
  const reasons = [];
  const p = patterns?.byCategory?.[category];
  const enough = (patterns?.coverage?.days ?? 0) >= ESCALATION.minCoverageDays;
  if (p && enough) {
    if (category === 'particles' && p.count >= ESCALATION.particlesEvents30d && (p.longCount / p.count >= ESCALATION.particlesLongShare || (p.medianRecoveryMin ?? 0) > ESCALATION.particlesMedianRecoveryMin)) {
      reasons.push(`This has happened ${p.count} times in the last ${patterns.windowDays} days, and particle levels take a while to clear each time.`);
    }
    if (category === 'ventilation' && patterns.overnightVentilation.nightsObserved >= ESCALATION.nightsMin && patterns.overnightVentilation.share >= ESCALATION.nightsShare) {
      reasons.push(`Fresh air has run low on ${patterns.overnightVentilation.nightsElevated} of the last ${patterns.overnightVentilation.nightsObserved} nights.`);
    }
    if (category === 'humidity' && (patterns.humidity.shareAbove60 >= ESCALATION.humidityShareAbove60 || patterns.humidity.shareAbove70 >= ESCALATION.humidityShareAbove70)) {
      reasons.push('Humidity has stayed above the comfort range for long stretches this month.');
    }
  }
  if (event && event.state !== 'resolved') {
    const acked = (event.acknowledgedActions || []).filter((a) => a.level === 'diy');
    const sinceAck = acked.length ? (now - Math.max(...acked.map((a) => a.at))) / 60 : 0;
    if (acked.length && sinceAck >= ESCALATION.persistentMinutes && (event.recoveryPct ?? 0) < 0.25) {
      reasons.push(`Levels have stayed high for ${Math.round(sinceAck)} minutes despite what you tried.`);
    }
  }
  return { eligible: reasons.length > 0, reasons };
}

/**
 * @typedef {Object} ContractorInsight
 * @property {string} id
 * @property {string} category  INSIGHT_CATEGORIES
 * @property {number} priority  1 = highest
 * @property {{score:number, level:string}} confidence
 * @property {string} problem  observed issue, plain English
 * @property {import('./types.js').Evidence[]} evidence
 * @property {string} homeownerImpact
 * @property {string[]} potentialSolutions
 * @property {string[]} contractorActions  what to inspect / discuss
 * @property {boolean} requiresProfessionalDiagnosis
 * @property {'equipment'|'behavior'|'environment'|'unclear'} likelyNature
 * @property {string} talkingPoints  what the technician should know before calling
 */

/**
 * @param {object} input
 * @param {object} input.patterns  from analyzePatterns
 * @param {object} input.household
 * @param {import('./types.js').DeviceCapabilities} input.capabilities
 * @param {object} [input.homeownerActions]  {purifierUses, exhaustUses, ventilateUses} counts in window
 * @param {number} input.now
 * @returns {ContractorInsight[]}
 */
export function contractorInsights({ patterns, household, capabilities, homeownerActions = {}, now }) {
  const out = [];
  if (!patterns || (patterns.coverage?.days ?? 0) < ESCALATION.minCoverageDays) return out;
  // Speak about the days actually recorded, not the nominal window.
  const coverageDays = Math.max(1, Math.round(patterns.coverage.days));
  const days = coverageDays < patterns.windowDays ? `${coverageDays} recorded` : String(patterns.windowDays);
  const p = patterns.byCategory.particles;
  const purifier = hasEquipment(household, 'portable_purifier');
  const wholeHome = hasEquipment(household, 'whole_home_air_cleaner');
  const hvac = household?.equipment?.find((e) => e.type === 'hvac');
  const filter = household?.equipment?.find((e) => e.type === 'hvac_filter');

  // --- filtration -----------------------------------------------------------
  if (capabilities.pm25 && p.count >= ESCALATION.particlesEvents30d) {
    const slow = (p.medianRecoveryMin ?? 0) > ESCALATION.particlesMedianRecoveryMin;
    const longShare = p.count ? p.longCount / p.count : 0;
    const cookingShare = p.count ? (p.bySource.cooking || 0) / p.count : 0;
    const e = [
      ev('measured', `${p.count} elevated fine-particle events in the last ${days} days`, true, 0.25),
      ev('measured', `${p.longCount} lasted longer than 30 minutes`, longShare >= ESCALATION.particlesLongShare, 0.15),
      p.medianRecoveryMin != null ? ev('derived', `Median recovery time ${Math.round(p.medianRecoveryMin)} minutes after the peak`, slow, 0.2) : null,
      cookingShare >= 0.5 ? ev('inferred', `${Math.round(cookingShare * 100)}% of events were likely cooking, a recurring indoor source`, true, 0.05) : null,
      purifier ? ev('context', `A portable purifier is recorded${(homeownerActions.purifierUses || 0) ? ` and was used ${homeownerActions.purifierUses} times` : ''}; clearance is still slow`, true, 0.1) : ev('context', 'No portable purifier recorded', false, 0),
      wholeHome ? ev('context', 'A whole-home air cleaner is recorded, yet recovery is slow: worth checking it is working', true, 0.1) : ev('context', 'No whole-home air cleaner recorded', true, 0.05),
      filter ? ev('context', `HVAC filter on record: ${filter.label}${filter.installedAt ? `, installed ${Math.round((now - filter.installedAt) / 86400)} days ago` : ''}`, true, filter.installedAt && now - filter.installedAt > 90 * 86400 ? 0.1 : 0) : ev('context', 'No HVAC filter details recorded', false, 0),
    ].filter(Boolean);
    const score = round2(Math.min(1, 0.15 + e.reduce((a, x) => a + (x.supports ? x.weight : -x.weight), 0) + (p.count >= 12 ? 0.1 : 0)));
    if (slow || longShare >= ESCALATION.particlesLongShare) {
      out.push({
        id: `filtration:${household?.id || 'home'}`,
        category: 'filtration',
        priority: 1,
        confidence: { score, level: confidenceLevel(score) },
        problem: `Fine-particle events occur frequently in this home and take ${slow ? 'a long time' : 'a while'} to clear.`,
        evidence: e,
        homeownerImpact: `${household?.profile?.sensitivities?.allergies ? 'With allergies in the household, ' : ''}particles stay elevated for roughly ${Math.round(p.medianRecoveryMin || p.medianDurationMin || 0)} minutes per event, about ${Math.round(p.totalMinutes / 60)} hours this month.`,
        potentialSolutions: ['Higher-efficiency HVAC filtration (subject to the system\'s static-pressure capability)', 'Whole-home air cleaner', 'Properly sized portable purifier for the affected room', cookingShare >= 0.5 ? 'Kitchen exhaust that vents outdoors, if the current one recirculates' : null].filter(Boolean),
        contractorActions: ['Inspect the current filter and its fit (bypass around the frame)', 'Verify HVAC airflow and fan settings during events', 'Evaluate filter upgrade compatibility before prescribing a MERV rating', wholeHome ? 'Check the installed air cleaner is operating' : 'Discuss whole-home filtration options'],
        requiresProfessionalDiagnosis: true,
        likelyNature: cookingShare >= 0.5 ? 'environment' : 'unclear',
        talkingPoints: `Recurring particle problem, mostly ${topSource(p.bySource)}. Homeowner already ${(homeownerActions.exhaustUses || homeownerActions.purifierUses) ? 'runs the exhaust/purifier' : 'has few mitigation tools'}; the question is why clearance is slow, not whether events happen.`,
      });
    } else if (p.count >= 15) {
      out.push({
        id: `source_control:${household?.id || 'home'}`,
        category: 'source_control',
        priority: 3,
        confidence: { score: 0.5, level: 'medium' },
        problem: 'Frequent particle events that clear quickly.',
        evidence: e,
        homeownerImpact: 'Short-lived, so the practical impact is modest.',
        potentialSolutions: ['Behavioral: run the exhaust before cooking starts', 'Confirm the range hood vents outdoors'],
        contractorActions: ['Discuss exhaust effectiveness; no equipment change indicated by the data alone'],
        requiresProfessionalDiagnosis: false,
        likelyNature: 'behavior',
        talkingPoints: 'Events clear fast. Do not pitch filtration on this evidence; a better exhaust habit solves most of it.',
      });
    }
  }

  // --- ventilation ------------------------------------------------------------
  const night = patterns.overnightVentilation;
  if (night.nightsObserved >= ESCALATION.nightsMin && night.share >= ESCALATION.nightsShare) {
    const trueCo2 = capabilities.trueCo2;
    const e = [
      ev('measured', `Elevated ${trueCo2 ? 'CO2' : 'estimated CO2'} on ${night.nightsElevated} of the last ${night.nightsObserved} nights`, true, 0.3),
      ev('measured', `Average ${Math.round(night.avgDurationMin / 60 * 10) / 10} hours per night above the household's normal range`, night.avgDurationMin >= 60, 0.15),
      ev('measured', `Average overnight peak about ${formatValue('co2', Math.round(night.avgPeak / 10) * 10)}`, night.avgPeak >= 1200, 0.15),
      trueCo2 ? ev('measured', 'Direct CO2 measurement', true, 0.1) : ev('measured', 'Only an estimate of CO2 is available on this device; treat as investigation, not diagnosis', false, 0.3),
      hasEquipment(household, 'fresh_air_ventilator') ? ev('context', 'A fresh-air ventilator is recorded; verify it runs overnight', true, 0.1) : ev('context', 'No fresh-air ventilation equipment recorded', true, 0.05),
    ];
    const score = round2(Math.min(1, 0.15 + e.reduce((a, x) => a + (x.supports ? x.weight : -x.weight), 0)));
    out.push({
      id: `ventilation:${household?.id || 'home'}`,
      category: trueCo2 ? 'ventilation' : 'investigation',
      priority: trueCo2 ? 1 : 3,
      confidence: { score, level: confidenceLevel(score) },
      problem: `Bedroom ${trueCo2 ? 'CO2' : 'estimated CO2'} regularly exceeds the household's normal range overnight.`,
      evidence: e,
      homeownerImpact: `Stuffy air for about ${Math.round(night.avgDurationMin / 60 * 10) / 10} hours a night on most nights.`,
      potentialSolutions: ['Fresh-air ventilation strategy (ERV/HRV where appropriate)', 'HVAC fan circulation schedule overnight', 'Duct balancing to the bedroom'],
      contractorActions: ['Inspect airflow to the bedroom', 'Verify HVAC fan and fresh-air damper operation overnight', 'Evaluate mechanical fresh-air options'],
      requiresProfessionalDiagnosis: true,
      likelyNature: 'equipment',
      talkingPoints: `Low fresh-air exchange while sleeping. Ask about door position and window habits first; then airflow.`,
    });
  }

  // --- humidity ---------------------------------------------------------------
  const h = patterns.humidity;
  if (capabilities.humidity && (h.shareAbove60 >= ESCALATION.humidityShareAbove60 || h.shareAbove70 >= ESCALATION.humidityShareAbove70)) {
    const e = [
      ev('measured', `Humidity above 60% for ${Math.round(h.shareAbove60 * 100)}% of the last ${days} days`, true, 0.3),
      h.shareAbove70 ? ev('measured', `Above 70% for ${Math.round(h.shareAbove70 * 100)}% of the time`, true, 0.2) : null,
      hasEquipment(household, 'dehumidifier') ? ev('context', 'A dehumidifier is recorded; verify operation', true, 0.1) : ev('context', 'No dehumidification equipment recorded', true, 0.05),
      household?.profile?.concerns?.mold ? ev('context', 'Homeowner lists moisture/mold as a concern', true, 0.05) : null,
    ].filter(Boolean);
    const score = round2(Math.min(1, 0.15 + e.reduce((a, x) => a + (x.supports ? x.weight : -x.weight), 0)));
    out.push({
      id: `humidity:${household?.id || 'home'}`,
      category: 'humidity_control',
      priority: 2,
      confidence: { score, level: confidenceLevel(score) },
      problem: 'Humidity remains above the recommended comfort range for long periods.',
      evidence: e,
      homeownerImpact: 'Sustained humidity above 60% encourages mould and dust mites and makes rooms feel warmer than they are.',
      potentialSolutions: ['Dehumidification (whole-home or room)', 'HVAC sizing and run-time review', 'Moisture-source correction (drainage, exhaust)'],
      contractorActions: ['Inspect HVAC operation and cooling cycle length', 'Look for moisture sources and drainage issues', 'Evaluate dehumidification options'],
      requiresProfessionalDiagnosis: true,
      likelyNature: 'unclear',
      talkingPoints: 'Persistent, not event-driven: this is a system or building question, not a behavior question.',
    });
  } else if (capabilities.humidity && h.shareBelow30 >= 0.3) {
    out.push({
      id: `dry:${household?.id || 'home'}`,
      category: 'humidity_control',
      priority: 3,
      confidence: { score: 0.45, level: 'medium' },
      problem: 'Indoor air is dry for a large share of the time.',
      evidence: [ev('measured', `Humidity below 30% for ${Math.round(h.shareBelow30 * 100)}% of the last ${days} days`, true, 0.3)],
      homeownerImpact: 'Dry air irritates skin and airways and increases static.',
      potentialSolutions: ['Humidification evaluation, if appropriate for the climate and system'],
      contractorActions: ['Discuss humidification; confirm it suits the region and building'],
      requiresProfessionalDiagnosis: false,
      likelyNature: 'environment',
      talkingPoints: 'Seasonal dryness is common; only worth raising if the homeowner notices discomfort.',
    });
  }

  // --- VOC: behavior first, never equipment from this evidence alone ----------
  const v = patterns.byCategory.voc;
  const vocNotCooking = v.count - (v.bySource.cooking || 0);
  if (capabilities.tvoc && vocNotCooking >= ESCALATION.vocEvents30d) {
    out.push({
      id: `voc:${household?.id || 'home'}`,
      category: 'source_control',
      priority: 3,
      confidence: { score: 0.5, level: 'medium' },
      problem: `Chemical/odor spikes happen often (${v.count} in ${days} days), mostly ${topSource(v.bySource)}.`,
      evidence: [ev('measured', `${v.count} VOC events, median duration ${Math.round(v.medianDurationMin || 0)} minutes`, true, 0.3)],
      homeownerImpact: 'Usually short-lived; opening a window clears them.',
      potentialSolutions: ['Source control: low-VOC products, lids on, ventilate while cleaning', 'Exhaust use during cleaning or cooking'],
      contractorActions: ['Conversation only; no equipment is indicated by VOC frequency alone'],
      requiresProfessionalDiagnosis: false,
      likelyNature: 'behavior',
      talkingPoints: 'This is a habits conversation. Do not sell on VOC spikes.',
    });
  }

  // --- unexplained recurring particles: investigation --------------------------
  if (capabilities.pm25 && p.count >= ESCALATION.particlesEvents30d && p.unknownShare >= 0.5 && !out.some((i) => i.category === 'filtration')) {
    out.push({
      id: `investigation:${household?.id || 'home'}`,
      category: 'investigation',
      priority: 2,
      confidence: { score: 0.4, level: 'low' },
      problem: `Recurring particle events (${p.count}) with no clear source signature.`,
      evidence: [ev('measured', `${p.count} particle events`, true, 0.2), ev('inferred', `${Math.round(p.unknownShare * 100)}% could not be attributed to a source`, true, 0.2)],
      homeownerImpact: 'Unexplained particle activity in the home.',
      potentialSolutions: ['On-site investigation: ductwork, return locations, outdoor infiltration paths'],
      contractorActions: ['Walk the home with the homeowner; correlate event times with activities'],
      requiresProfessionalDiagnosis: true,
      likelyNature: 'unclear',
      talkingPoints: 'Bring the event-time histogram; ask what happens at those hours.',
    });
  }

  // Under a week of data is a hint, not a diagnosis.
  if (coverageDays < 7) {
    for (const i of out) {
      i.confidence = { score: Math.min(i.confidence.score, 0.44), level: 'low' };
      i.problem = `${i.problem} (${coverageDays} days of data so far)`;
    }
  }
  return out.sort((a, b) => a.priority - b.priority || b.confidence.score - a.confidence.score);
}

function topSource(bySource) {
  const entries = Object.entries(bySource || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'unknown';
  const [src] = entries[0];
  return ({ cooking: 'cooking', cleaning: 'cleaning products', dust: 'dust disturbance', outdoor_pollution: 'outdoor air', combustion: 'combustion sources', poor_ventilation: 'poor ventilation', shower: 'showers', unknown: 'of unknown origin' })[src] || src;
}

/**
 * Opportunity signals: insight-derived, with status tracked by the contractor.
 * Existing signals keep their id/status; the score and evidence refresh.
 */
export function opportunitySignals(insights, { householdId, now, existing = [] }) {
  return insights
    .filter((i) => i.requiresProfessionalDiagnosis || i.category === 'filtration' || i.category === 'ventilation' || i.category === 'humidity_control')
    .map((i) => {
      const id = `${householdId}:${i.category}`;
      const prev = existing.find((s) => s.id === id);
      const recurring = i.evidence.find((e) => /events|nights/.test(e.text));
      return {
        id,
        householdId,
        type: i.category === 'humidity_control' ? 'humidity' : i.category,
        detectedAt: prev?.detectedAt || now,
        updatedAt: now,
        score: round2(i.confidence.score * (i.priority === 1 ? 1 : 0.8)),
        confidence: i.confidence.level,
        evidence: i.evidence.map((e) => e.text),
        recurringEventCount: recurring ? Number((recurring.text.match(/\d+/) || [0])[0]) : 0,
        homeownerImpact: i.homeownerImpact,
        problem: i.problem,
        potentialSolutions: i.potentialSolutions,
        status: prev?.status || 'new',
        insightId: i.id,
      };
    });
}
