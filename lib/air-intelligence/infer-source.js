/* Source inference: from features to a ranked, evidence-backed hypothesis.
 *
 * Every candidate carries the evidence for and against it. The winner must
 * clear a minimum score and a margin over the runner-up, otherwise the
 * hypothesis is "unknown" with the candidates listed as possibilities. Some
 * sources (pet activity, outdoor pollution without outdoor data) are capped
 * so the product never claims more than the sensors can know.
 */

import { SOURCE_LABEL } from './types.js';
import { CHANNEL_INFO, formatValue } from './thresholds.js';
import { confidenceLevel, scoreEvidence, evidence as ev, round2 } from './confidence.js';
import { localHour } from './baseline.js';
import { isMealtime, isNight } from './household.js';
import { outdoorPollutionHigh } from './outdoor.js';

const MIN_WIN = 0.45;
const MIN_MARGIN = 0.12;
const CAPS = { pet_activity: 0.3, outdoor_pollution_no_data: 0.35 };

const fmt = (c, v) => formatValue(c, v);
const times = (r) => `${r >= 10 ? Math.round(r) : r.toFixed(1)}×`;

function riseText(f) {
  const start = f.baseline.median;
  return `${CHANNEL_INFO[f.channel].friendly} rose from about ${fmt(f.channel, start)} to ${fmt(f.channel, f.peak ? f.peak.v : f.current)}`;
}

function changed(f, min = 1.3) {
  return Boolean(f && f.current != null && Number.isFinite(f.ratio) && f.ratio >= min && (f.elevated || f.trend === 'rising'));
}

function flat(f) {
  return Boolean(f && f.current != null && Number.isFinite(f.ratio) && f.ratio < 1.25 && f.trend !== 'rising');
}

/**
 * @param {object} input
 * @param {string} input.category
 * @param {string} input.channel
 * @param {Object<string, import('./features.js').ChannelFeatures>} input.features
 * @param {object} input.cross  from crossFeatures
 * @param {{roomType?:string, profile?:object, equipment?:object[]}} [input.context]
 * @param {object} [input.outdoor]  OutdoorAir
 * @param {number} input.now
 * @param {string} [input.timeZone]
 */
export function inferSource({ category, channel, features, cross, context = {}, outdoor, now, timeZone }) {
  const f = features[channel];
  const hour = localHour(now, timeZone);
  const profile = context.profile || {};
  const roomType = context.roomType || 'other';
  const candidates = [];
  const add = (source, items, { prior = 0.2, cap = 1 } = {}) => {
    const list = items.filter(Boolean);
    candidates.push({ source, label: SOURCE_LABEL[source], score: round2(scoreEvidence(list, { prior, cap })), evidence: list });
  };

  const measured = (ff) => ff && ff.current != null && ev('measured', riseText(ff), true, 0, ff.channel);
  const pm = features.pm25, tvoc = features.tvoc, co2 = features.co2 || features.eco2, hum = features.hum;
  const onset = f?.onsetMinutes;
  // While a level is still climbing the peak is the latest sample, so "time to
  // 80 % of the peak" understates the onset; a ramp that has already run for
  // more than ten minutes is not a sudden one.
  const stillRising = Boolean(f && f.trend === 'rising' && f.peak && now - f.peak.t <= 120);
  // A rise still in progress is not yet "sudden": at minute three of any
  // climb everything looks fast. Suddenness is judged once the peak has passed.
  const fast = onset != null && onset <= 10 && !stillRising;
  const slow = onset != null && (onset >= 25 || (stillRising && f.elevatedMinutes >= 25));
  const onsetText = onset == null ? null : onset <= 10
    ? ev('derived', `The increase happened quickly, over about ${Math.max(1, Math.round(onset))} minute${Math.round(onset) === 1 ? '' : 's'}`, true, 0.0)
    : ev('derived', `The increase was gradual, over about ${Math.round(onset)} minutes`, true, 0.0);
  const outdoorHigh = outdoorPollutionHigh(outdoor);
  const outdoorNote = outdoor?.status === 'available'
    ? ev('context', outdoorHigh ? `Outdoor particle pollution is high right now (${fmt('pm25', outdoor.pm25)})` : `Outdoor air is ${outdoor.pm25 != null ? fmt('pm25', outdoor.pm25) : 'acceptable'} right now`, Boolean(outdoorHigh), 0.3)
    : ev('context', 'Outdoor air data is not connected, so outdoor influence cannot be confirmed', false, 0.05);

  if (category === 'particles') {
    const coarseRel = cross.pm10to25 != null ? cross.pm10to25 / (cross.pm10to25Baseline || 1.6) : null;
    const coarse = coarseRel != null && (coarseRel >= 1.8 || cross.pm10to25 >= 3);
    const somewhatCoarse = coarseRel != null && !coarse && coarseRel >= 1.3;
    const fine = cross.pm1to25 != null && cross.pm1to25 >= 0.6;
    const notFine = cross.pm1to25 != null && cross.pm1to25 <= 0.45;
    const tvocUp = changed(tvoc, 1.5);
    const tvocFlat = flat(tvoc);
    const co2Flat = flat(co2);
    const mealtime = isMealtime(hour);

    add('cooking', [
      measured(pm),
      tvocUp ? ev('measured', `${CHANNEL_INFO.tvoc.friendly} rose ${times(tvoc.ratio)} at the same time`, true, 0.25, 'tvoc')
        : tvocFlat ? ev('measured', 'Chemicals & odors stayed near normal', false, 0.15, 'tvoc') : null,
      fast ? ev('derived', 'Sudden onset, typical of frying or searing', true, 0.25) : slow ? ev('derived', 'Gradual onset is unusual for cooking', false, 0.2) : null,
      fine ? ev('derived', 'Mostly very fine particles, typical of combustion', true, 0.1) : coarse ? ev('derived', 'Coarse particles rose more than fine ones, which points away from cooking', false, 0.2) : somewhatCoarse ? ev('derived', 'Somewhat coarser particles than usual', false, 0.1) : null,
      roomType === 'kitchen' ? ev('context', 'This device is in the kitchen', true, 0.15) : ev('context', 'No kitchen location context for this device', false, 0.05),
      mealtime ? ev('context', 'It is a typical mealtime', true, 0.1) : null,
      co2Flat ? ev('measured', 'Fresh-air level unchanged', true, 0.0, co2?.channel) : null,
    ]);

    add('combustion', [
      measured(pm),
      fast ? ev('derived', 'Sudden onset', true, 0.2) : null,
      fine ? ev('derived', 'Mostly very fine particles', true, 0.2) : notFine ? ev('derived', 'Not dominated by the finest particles', false, 0.15) : null,
      tvocFlat ? ev('measured', 'Little change in chemicals & odors, so an open flame or smoke is as likely as cooking', true, 0.1, 'tvoc') : null,
      coarse ? ev('derived', 'Coarse particles dominate', false, 0.25) : somewhatCoarse ? ev('derived', 'Somewhat coarser than usual', false, 0.1) : null,
    ], { prior: 0.15 });

    add('dust', [
      measured(pm),
      cross.pm10to25 == null ? ev('measured', 'No coarse-particle channel on this device', false, 0.1) : coarse
        ? ev('derived', `Coarse particles are ${cross.pm10to25.toFixed(1)}× fine particles, more than usual`, true, 0.35, 'pm10')
        : somewhatCoarse ? ev('derived', `Coarse particles are ${cross.pm10to25.toFixed(1)}× fine particles, somewhat more than usual`, true, 0.15, 'pm10')
        : ev('derived', 'Coarse and fine particles rose together', false, 0.2, 'pm10'),
      tvocFlat ? ev('measured', 'Chemicals & odors unchanged', true, 0.1, 'tvoc') : null,
      f && f.elevatedMinutes < 20 && f.trend === 'falling' ? ev('derived', 'Short-lived and already settling', true, 0.1) : null,
      profile.concerns?.dust ? ev('context', 'Dust is a stated concern in this home', true, 0.05) : null,
    ]);

    const outdoorCap = outdoor?.status === 'available' ? 1 : CAPS.outdoor_pollution_no_data;
    add('outdoor_pollution', [
      measured(pm),
      slow ? ev('derived', 'Gradual increase, as when outdoor air drifts in', true, 0.2) : fast ? ev('derived', 'Sudden onset is unusual for outdoor infiltration', false, 0.2) : null,
      f && f.elevatedMinutes >= 30 ? ev('derived', `Elevated for ${Math.round(f.elevatedMinutes)} minutes`, true, 0.1) : null,
      tvocFlat ? ev('measured', 'Chemicals & odors unchanged', true, 0.1, 'tvoc') : null,
      co2Flat ? ev('measured', 'Fresh-air level unchanged', true, 0.05, co2?.channel) : null,
      outdoorNote,
    ], { cap: outdoorCap });

    if (profile.pets?.hasPets) {
      add('pet_activity', [
        measured(pm),
        ev('context', 'This home has pets, so pet activity is one possible contributor; the sensor cannot identify dander', true, 0.1),
        coarse ? ev('derived', 'Coarse particles rose more than fine ones', true, 0.1) : null,
      ], { prior: 0.1, cap: CAPS.pet_activity });
    }
  }

  if (category === 'voc') {
    const pmFlat = flat(pm);
    const pmUp = changed(pm, 1.5);
    add('cleaning', [
      measured(tvoc),
      fast ? ev('derived', 'Sharp increase over a few minutes', true, 0.3) : slow ? ev('derived', 'Slow build-up is less typical of a spray or wipe', false, 0.15) : null,
      pm ? (pmFlat ? ev('measured', 'Particle levels stayed relatively stable', true, 0.2, 'pm25') : pmUp ? ev('measured', 'Particles rose too, which points more to cooking', false, 0.25, 'pm25') : null) : ev('measured', 'No particle channel to compare against', false, 0.05),
      flat(co2) ? ev('measured', 'Fresh-air level unchanged', true, 0.1, co2?.channel) : null,
      f && f.ratio >= 2 ? ev('derived', `${times(f.ratio)} the usual level`, true, 0.1) : null,
    ]);
    add('cooking', [
      measured(tvoc),
      pmUp ? ev('measured', 'Fine particles rose as well', true, 0.3, 'pm25') : pmFlat ? ev('measured', 'Particles did not rise', false, 0.2, 'pm25') : null,
      isMealtime(hour) ? ev('context', 'It is a typical mealtime', true, 0.1) : null,
      roomType === 'kitchen' ? ev('context', 'This device is in the kitchen', true, 0.15) : null,
    ], { prior: 0.15 });
  }

  if (category === 'ventilation') {
    const trueCo2 = channel === 'co2';
    const gradual = f && f.elevatedMinutes >= 20 && !fast;
    add('poor_ventilation', [
      measured(f),
      trueCo2 ? ev('measured', 'This is a direct CO2 measurement', true, 0.25, 'co2')
        : ev('measured', 'Only an estimate of CO2 from the gas sensor is available, which also reacts to odors and fumes', false, 0.35, 'eco2'),
      gradual ? ev('derived', `Climbing steadily for ${Math.round(f.elevatedMinutes)} minutes, as a room with people and little fresh air does`, true, 0.25) : fast ? ev('derived', 'Rose quickly, which is unusual for ventilation alone', false, 0.1) : null,
      hum && hum.trend === 'rising' ? ev('measured', 'Humidity is slowly rising too', true, 0.05, 'hum') : null,
      flat(pm) && flat(tvoc) ? ev('measured', 'Particles and odors are near normal', true, 0.1) : null,
      isNight(hour) ? ev('context', 'Overnight, with doors and windows usually closed', true, 0.1) : null,
      changed(tvoc, 1.8) && !trueCo2 ? ev('measured', 'Odors are also up, which inflates the estimate', false, 0.2, 'tvoc') : null,
    ], { prior: 0.25 });
    if (!trueCo2) {
      add('cleaning', [measured(f), changed(tvoc, 1.8) ? ev('measured', 'Chemicals & odors are up; eCO2 follows them', true, 0.3, 'tvoc') : null, flat(pm) ? ev('measured', 'Particles stable', true, 0.1, 'pm25') : null], { prior: 0.1 });
    }
  }

  if (category === 'humidity') {
    const quick = f && f.onsetMinutes != null && f.onsetMinutes <= 15 && f.delta >= 8;
    add('shower', [
      measured(f),
      quick ? ev('derived', `Humidity jumped ${Math.round(f.delta)} points within about ${Math.round(f.onsetMinutes)} minutes`, true, 0.35) : ev('derived', 'The rise was slow, unlike steam from a shower', false, 0.2),
      flat(pm) && flat(tvoc) ? ev('measured', 'Particles and odors unchanged', true, 0.15) : null,
      roomType === 'bathroom' ? ev('context', 'This device is in a bathroom', true, 0.2) : null,
      f && f.elevatedMinutes > 90 ? ev('derived', 'Still elevated after more than 90 minutes', false, 0.2) : null,
    ]);
    add('poor_ventilation', [
      measured(f),
      f && f.elevatedMinutes >= 120 ? ev('derived', `Humidity has stayed high for ${Math.round(f.elevatedMinutes / 60)} hours, so moisture is not clearing`, true, 0.35) : null,
      changed(co2, 1.3) ? ev('measured', 'Fresh-air level is also elevated', true, 0.15, co2?.channel) : null,
      profile.concerns?.mold ? ev('context', 'Moisture is a stated concern in this home', true, 0.05) : null,
    ], { prior: 0.1 });
  }

  candidates.sort((a, b) => b.score - a.score);
  const eligible = candidates.filter((c) => c.source !== 'pet_activity');
  const top = eligible[0];
  const second = eligible[1];
  let winner = null;
  if (top && top.score >= MIN_WIN && (!second || top.score - second.score >= MIN_MARGIN)) winner = top;

  const alternatives = candidates.filter((c) => c !== winner).map((c) => ({ source: c.source, label: c.label, score: c.score, level: confidenceLevel(c.score) }));
  if (winner) {
    return {
      source: winner.source,
      label: winner.label,
      confidence: { score: winner.score, level: confidenceLevel(winner.score), evidence: winner.evidence, alternatives },
      candidates,
    };
  }
  const unknownEvidence = [measured(f), ev('inferred', top ? `Several explanations fit about equally well: ${eligible.slice(0, 3).map((c) => c.label.toLowerCase()).join(', ')}` : 'Not enough evidence to name a source', false, 0)].filter(Boolean);
  return {
    source: 'unknown',
    label: SOURCE_LABEL.unknown,
    confidence: { score: top ? Math.min(0.35, top.score) : 0.1, level: 'low', evidence: unknownEvidence, alternatives },
    candidates,
  };
}
