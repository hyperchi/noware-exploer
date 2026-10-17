/* Recommendation engine: what to do, in three levels.
 *
 *   diy        - do it yourself now (exhaust, window, purifier, fan)
 *   check      - check something (filter, purifier running, vents)
 *   contractor - ask your contractor, only when escalation is justified
 *
 * Each recommendation is an action object the UI can show as a button and a
 * smart-home integration can later execute. Nothing here says "open a
 * window" when outdoor data says outdoor air is worse, and nothing says
 * "contact a professional" when a kitchen hood would do.
 */

import { CHANNEL_INFO } from './thresholds.js';
import { hasEquipment, personalNotes } from './household.js';
import { outdoorCleanerThanIndoors, outdoorPollutionHigh } from './outdoor.js';
import { escalationFor } from './contractor.js';

const rec = (o) => ({ level: 'diy', priority: 3, acknowledged: false, acknowledgedAt: null, smartHome: null, condition: null, ...o });

function windowAdvice(outdoor, indoorPm25, { forParticles }) {
  const cleaner = outdoorCleanerThanIndoors(outdoor, indoorPm25);
  const high = outdoorPollutionHigh(outdoor);
  const outdoorReason = Number.isFinite(outdoor?.pm25)
    ? `${outdoor.kind === 'modeled' ? 'Regional outdoor PM2.5 is estimated at' : 'Outdoor PM2.5 is about'} ${Math.round(outdoor.pm25)} µg/m³.`
    : 'The outdoor provider reports elevated pollution.';
  if (high) {
    return rec({
      id: 'close_windows', actionType: 'close_windows', level: 'diy', priority: 1,
      title: 'Keep windows closed',
      description: 'Outdoor particle pollution appears worse than indoors right now.',
      reason: outdoorReason,
      expectedImpact: 'Stops more particles coming in while filtration works.',
      smartHome: { capability: 'windows', command: 'close' },
    });
  }
  if (cleaner === null) {
    return rec({
      id: 'ventilate', actionType: 'ventilate', level: 'diy', priority: forParticles ? 2 : 1,
      title: 'Open a window for 10–15 minutes',
      description: forParticles ? 'Only if outdoor air is cleaner than indoors.' : 'A few minutes of fresh air usually clears this.',
      reason: 'Outdoor air data is not connected for this home, so check conditions outside before opening up.',
      expectedImpact: forParticles ? 'Dilutes indoor particles when outdoor air is clean.' : 'Levels usually fall within 10–20 minutes.',
      condition: 'outdoor_unknown',
      smartHome: { capability: 'windows', command: 'open' },
    });
  }
  if (cleaner) {
    return rec({
      id: 'ventilate', actionType: 'ventilate', level: 'diy', priority: 1,
      title: 'Open a window for 10–15 minutes',
      description: 'Outdoor air is cleaner than indoors right now.',
      reason: outdoorReason,
      expectedImpact: 'Levels usually fall within 10–20 minutes.',
      smartHome: { capability: 'windows', command: 'open' },
    });
  }
  return rec({
    id: 'close_windows', actionType: 'close_windows', level: 'diy', priority: 2,
    title: 'Keep windows closed for now',
    description: 'Outdoor air is not cleaner than indoors at the moment.',
    reason: outdoorReason,
    expectedImpact: 'Avoids pulling in more particles.',
    smartHome: { capability: 'windows', command: 'close' },
  });
}

/**
 * @param {object} input
 * @param {import('./types.js').AirEvent} input.event
 * @param {Object<string, import('./features.js').ChannelFeatures>} input.features
 * @param {{household?:object, roomType?:string, profile?:object}} [input.context]
 * @param {object} [input.outdoor]
 * @param {object} [input.patterns]
 * @param {object} [input.contractor]  assigned contractor, if any
 * @param {number} input.now
 */
export function recommend({ event, features, context = {}, outdoor, patterns, contractor, now }) {
  const household = context.household;
  const profile = context.profile || household?.profile || {};
  const roomType = context.roomType || 'other';
  const source = event.hypothesis?.source || 'unknown';
  const confident = (event.hypothesis?.confidence?.level || 'low') !== 'low';
  const indoorPm25 = features.pm25?.current ?? null;
  const purifier = hasEquipment(household, 'portable_purifier');
  const exhaust = roomType === 'kitchen' || hasEquipment(household, 'kitchen_exhaust');
  const out = [];

  if (event.category === 'particles') {
    if (source === 'cooking' || (source === 'combustion' && roomType === 'kitchen') || (source === 'unknown' && roomType === 'kitchen')) {
      out.push(rec({
        id: 'exhaust', actionType: 'exhaust', priority: 1,
        title: 'Turn on the kitchen exhaust',
        description: 'Run the hood until particle levels return close to your normal range.',
        reason: confident ? 'Fine particles and chemicals rose together quickly, which is what cooking looks like.' : 'Cooking is the most common cause of a sudden particle rise.',
        expectedImpact: 'Most kitchens return to normal within 15–25 minutes.',
        smartHome: { capability: 'exhaust', command: 'on' },
      }));
      out.push(windowAdvice(outdoor, indoorPm25, { forParticles: true }));
      out.push(rec({
        id: 'purifier', actionType: 'purifier', priority: 3,
        title: purifier ? 'Run your air purifier' : 'Run an air purifier if you have one',
        description: 'Keep it on until fine particles are back near your normal level.',
        reason: 'Filtration removes particles directly, whatever the outdoor air is doing.',
        expectedImpact: 'Faster clearance, especially in a closed room.',
        smartHome: { capability: 'purifier', command: 'on' },
      }));
    } else if (source === 'outdoor_pollution') {
      out.push(rec({
        id: 'close_windows', actionType: 'close_windows', priority: 1,
        title: 'Close windows and run filtration',
        description: outdoor?.status === 'available' ? 'Outdoor particle pollution appears worse than indoors.' : 'The slow rise suggests outdoor air may be coming in, though outdoor data is not connected to confirm it.',
        reason: event.hypothesis?.confidence?.evidence?.find((e) => e.kind === 'derived')?.text || 'Gradual increase with no indoor signature.',
        expectedImpact: 'Stops more particles coming in.',
        smartHome: { capability: 'windows', command: 'close' },
      }));
      out.push(rec({ id: 'purifier', actionType: 'purifier', priority: 2, title: purifier ? 'Run your air purifier' : 'Run an air purifier if you have one', description: 'Filtration is the main lever when the source is outside.', reason: 'Particles are elevated while chemicals and fresh air are normal.', expectedImpact: 'Steady decline while windows stay closed.', smartHome: { capability: 'purifier', command: 'on' } }));
    } else if (source === 'dust') {
      out.push(rec({ id: 'settle', actionType: 'wait', priority: 1, title: 'Let it settle', description: 'Avoid stirring up more dust for a few minutes; coarse particles settle on their own.', reason: 'Coarse particles rose more than fine ones.', expectedImpact: 'Usually back to normal within 10–20 minutes.' }));
      out.push(rec({ id: 'purifier', actionType: 'purifier', priority: 2, title: purifier ? 'Run your air purifier' : 'Run an air purifier if you have one', description: 'Speeds up clearance of what stays airborne.', reason: 'Filtration catches the finer fraction that does not settle.', expectedImpact: 'Faster clearance.', smartHome: { capability: 'purifier', command: 'on' } }));
    } else {
      out.push(rec({ id: 'purifier', actionType: 'purifier', priority: 1, title: purifier ? 'Run your air purifier' : 'Run filtration for now', description: source === 'unknown' ? "We're not sure what caused this, so filtration is the safe first step." : 'Keep it on until particles are back near normal.', reason: 'Particle levels are elevated; filtration helps regardless of source.', expectedImpact: 'Steady decline over the next 15–30 minutes.', smartHome: { capability: 'purifier', command: 'on' } }));
      if (exhaust) out.push(rec({ id: 'exhaust', actionType: 'exhaust', priority: 2, title: 'Turn on the kitchen exhaust', description: 'If anything is cooking or burning, the hood is the fastest fix.', reason: 'Combustion sources are a common cause of fine-particle spikes.', expectedImpact: 'Noticeable within 10 minutes if the source is in the kitchen.', smartHome: { capability: 'exhaust', command: 'on' } }));
      out.push(windowAdvice(outdoor, indoorPm25, { forParticles: true }));
    }
    if ((patterns?.byCategory?.particles?.count ?? 0) >= 5 && hasEquipment(household, 'hvac')) {
      out.push(rec({ id: 'check_filter', level: 'check', actionType: 'check_filter', priority: 4, title: 'Check your HVAC filter', description: 'A loaded filter clears particles slowly. Check it is clean and seated without gaps.', reason: `Particle events have recurred ${patterns.byCategory.particles.count} times this month.`, expectedImpact: 'Shorter recovery after future events.' }));
    }
    if (purifier && event.durationMinutes > 30 && (event.recoveryPct ?? 0) < 0.3) {
      out.push(rec({ id: 'check_purifier', level: 'check', actionType: 'check_purifier', priority: 4, title: 'Check the purifier is actually running', description: 'Confirm it is on, on a high enough setting, and its filter is not overdue.', reason: 'Levels have not come down much in over 30 minutes.', expectedImpact: 'Clearance should start within 15 minutes once it is working.' }));
    }
  }

  if (event.category === 'voc') {
    out.push(windowAdvice(outdoor, indoorPm25, { forParticles: false }));
    if (source === 'cleaning') out.push(rec({ id: 'reduce_source', actionType: 'reduce_source', priority: 2, title: 'Put lids back on and finish up', description: 'Sprays and solvents keep releasing vapour while they are open.', reason: 'Chemicals jumped while particles stayed stable, which points to a product rather than cooking.', expectedImpact: 'Levels fall quickly once the source is capped.' }));
    if (source === 'cooking' && exhaust) out.push(rec({ id: 'exhaust', actionType: 'exhaust', priority: 1, title: 'Turn on the kitchen exhaust', description: 'Run it until odors clear.', reason: 'Particles rose with the odors.', expectedImpact: '10–20 minutes.', smartHome: { capability: 'exhaust', command: 'on' } }));
    if (source === 'unknown') out.push(rec({ id: 'look', actionType: 'reduce_source', priority: 2, title: 'Look for the source', description: 'New furniture, paint, fragrance, a running appliance or an open container can all do this.', reason: 'The signature does not match cleaning or cooking clearly.', expectedImpact: 'Removing the source clears it faster than ventilation alone.' }));
  }

  if (event.category === 'ventilation') {
    out.push(rec({ id: 'ventilate', actionType: 'ventilate', priority: 1, title: 'Open a window or door for a few minutes', description: 'Fresh air is the only thing that brings this down.', reason: event.channel === 'co2' ? `CO2 has been climbing for ${Math.round(event.durationMinutes)} minutes, which usually means the room isn't getting enough fresh air.` : 'Estimated CO2 is elevated; it is derived from the gas sensor, so this is a weaker signal.', expectedImpact: 'Noticeable within 10 minutes with a window open.', smartHome: { capability: 'windows', command: 'open' } }));
    if (hasEquipment(household, 'fresh_air_ventilator') || hasEquipment(household, 'hvac')) out.push(rec({ id: 'hvac_fan', actionType: 'ventilate', priority: 2, title: hasEquipment(household, 'fresh_air_ventilator') ? 'Run the fresh-air ventilator' : 'Set the HVAC fan to on', description: 'Moves air through the home even with windows closed.', reason: 'Mechanical ventilation helps overnight when windows stay shut.', expectedImpact: 'Gradual improvement over 20–30 minutes.', smartHome: { capability: 'hvac_fan', command: 'on' } }));
    if ((patterns?.overnightVentilation?.nightsElevated ?? 0) >= 3) out.push(rec({ id: 'check_vents', level: 'check', actionType: 'check_vents', priority: 4, title: 'Check the room\'s vents are open and unblocked', description: 'Closed registers or a shut door starve a bedroom of air overnight.', reason: `Fresh air has run low on ${patterns.overnightVentilation.nightsElevated} recent nights.`, expectedImpact: 'Lower overnight peaks.' }));
  }

  if (event.category === 'humidity') {
    if (event.direction === 'low') {
      out.push(rec({ id: 'humidify', actionType: 'wait', priority: 1, title: 'Add some moisture', description: 'A humidifier, or simply drying laundry indoors, raises humidity gently.', reason: 'Humidity is below the comfort range.', expectedImpact: 'Comfort improves within an hour or two.' }));
    } else if (source === 'shower') {
      out.push(rec({ id: 'bathroom_fan', actionType: 'bathroom_fan', priority: 1, title: 'Run the bathroom fan for 20 minutes', description: 'Leave the door open afterwards so moisture can escape.', reason: 'Humidity jumped quickly without other changes, which is what steam does.', expectedImpact: 'Back to normal within 20–40 minutes.', smartHome: { capability: 'exhaust', command: 'on' } }));
    } else {
      out.push(rec({ id: 'ventilate', actionType: 'ventilate', priority: 1, title: 'Ventilate the room', description: 'Open a window or run an exhaust fan until humidity drops below 60%.', reason: `Humidity has stayed high for ${Math.round(event.durationMinutes)} minutes.`, expectedImpact: 'Gradual improvement.', smartHome: { capability: 'windows', command: 'open' } }));
      if (hasEquipment(household, 'dehumidifier')) out.push(rec({ id: 'dehumidifier', actionType: 'purifier', priority: 2, title: 'Run the dehumidifier', description: 'Set it to 50% and let it run.', reason: 'Sustained humidity rarely clears on its own.', expectedImpact: 'Several hours to settle.', smartHome: { capability: 'dehumidifier', command: 'on' } }));
      out.push(rec({ id: 'check_moisture', level: 'check', actionType: 'check_moisture', priority: 3, title: 'Look for an obvious moisture source', description: 'Wet laundry, a leak, an unvented dryer or a running shower nearby.', reason: 'Sustained humidity usually has a source.', expectedImpact: 'Removing it solves the problem.' }));
    }
  }

  if (event.category === 'temperature') {
    out.push(rec({ id: 'comfort', actionType: 'wait', priority: 2, title: event.direction === 'low' ? 'The room is cold' : 'The room is hot', description: 'Adjust heating or cooling; this does not affect air quality.', reason: 'Temperature is well outside the comfort range.', expectedImpact: 'Comfort only.' }));
  }

  // Contractor step, only when justified.
  const escalation = escalationFor({ category: event.category, patterns, event, now });
  if (escalation.eligible) {
    const topic = ({ particles: 'your filtration setup', ventilation: 'ventilation in this room', humidity: 'humidity control', voc: 'this', temperature: 'this' })[event.category];
    out.push(rec({
      id: 'contact_contractor', level: 'contractor', actionType: 'contact_contractor', priority: 5,
      title: contractor ? `Ask ${contractor.name} about ${topic}` : `Consider asking a home-comfort professional about ${topic}`,
      description: escalation.reasons.join(' '),
      reason: 'Repeated or persistent problems are where a professional look at the system pays off.',
      expectedImpact: 'A conversation backed by your measurements, not a sales pitch.',
      contractorId: contractor?.id || null,
      noContractor: !contractor,
    }));
  }

  // Personalization notes ride along with the top recommendation.
  const notes = personalNotes(profile, event.category);
  if (notes.length && out[0]) out[0].personalNote = notes[0];

  out.sort((a, b) => a.priority - b.priority);
  for (const r of out) {
    const ack = (event.acknowledgedActions || []).find((a) => a.id === r.id);
    if (ack) {
      r.acknowledged = true;
      r.acknowledgedAt = ack.at;
    }
  }
  return out;
}

export function channelFriendly(channel) {
  return CHANNEL_INFO[channel]?.friendly || channel;
}
