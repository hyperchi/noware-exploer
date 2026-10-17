/* Household context: profile, rooms, equipment, contractor relationship.
 *
 * Context personalizes language and nudges hypotheses. It never manufactures
 * a detection: a cat in the profile makes "pet activity" a listed possible
 * contributor to particle activity, it does not make the sensor an allergen
 * detector.
 */

import { DEFAULT_HOUSEHOLD_PROFILE } from './types.js';

export function defaultProfile() {
  return JSON.parse(JSON.stringify(DEFAULT_HOUSEHOLD_PROFILE));
}

export function mergeProfile(base, patch) {
  const out = defaultProfile();
  for (const section of ['sensitivities', 'pets', 'concerns']) {
    Object.assign(out[section], base?.[section] || {}, patch?.[section] || {});
  }
  if (!Array.isArray(out.pets.types)) out.pets.types = [];
  return out;
}

/**
 * @typedef {Object} Household
 * @property {string} id
 * @property {string} name
 * @property {string} [timeZone]
 * @property {string[]} members  emails allowed to see this home
 * @property {object} profile  see DEFAULT_HOUSEHOLD_PROFILE
 * @property {{id:string,name:string,type:string,deviceKeys:string[]}[]} rooms
 * @property {{id:string,type:string,label:string,details?:object,installedAt?:number}[]} equipment
 * @property {string[]} deviceKeys  devices attached to this household
 */

export function roomOfDevice(household, deviceKey) {
  return household?.rooms?.find((r) => (r.deviceKeys || []).includes(deviceKey)) || null;
}

export function hasEquipment(household, type) {
  return Boolean(household?.equipment?.some((e) => e.type === type));
}

export function equipmentLabels(household) {
  return (household?.equipment || []).map((e) => e.label || e.type);
}

export function isMealtime(hour) {
  return (hour >= 6 && hour < 9.5) || (hour >= 11 && hour < 14) || (hour >= 17 && hour < 21.5);
}

export function isNight(hour) {
  return hour >= 22 || hour < 7;
}

/**
 * Gentle, non-clinical sentences added to explanations when the household
 * has told us something relevant. Environmental guidance, not diagnosis.
 */
export function personalNotes(profile, category) {
  const notes = [];
  const p = profile || defaultProfile();
  if (category === 'particles') {
    if (p.sensitivities?.allergies) notes.push('Since allergies are a concern in this home, bringing particle levels back down may make the room more comfortable.');
    if (p.sensitivities?.asthma) notes.push('With respiratory sensitivity in the household, clearing fine particles sooner rather than later is worthwhile.');
    if (p.sensitivities?.youngChildren) notes.push('For rooms where children spend a lot of time, you may want to run filtration until levels return to normal.');
    if (p.pets?.hasPets) notes.push('Because this home has pets, pet activity may be one possible contributor, along with dust, outdoor particles or cooking.');
  }
  if (category === 'voc') {
    if (p.sensitivities?.asthma || p.concerns?.odors) notes.push('Strong odors and sprays can be more noticeable for sensitive residents; a few minutes of fresh air usually clears them.');
  }
  if (category === 'humidity') {
    if (p.concerns?.mold) notes.push('You mentioned moisture is a concern: keeping humidity under 60 % for most of the day is the single biggest lever.');
  }
  if (category === 'ventilation') {
    if (p.sensitivities?.youngChildren || p.sensitivities?.elderlyResidents) notes.push('Fresh air overnight helps everyone sleep better, especially in rooms shared by several people.');
  }
  return notes;
}

/**
 * @typedef {Object} Contractor
 * @property {string} id
 * @property {string} name
 * @property {string} [tagline]
 * @property {string[]} members  emails of contractor staff
 * @property {{phone?:string,email?:string,messageUrl?:string,bookingUrl?:string}} contact
 */

/**
 * @typedef {Object} HouseholdContractor
 * @property {string} householdId
 * @property {string} contractorId
 * @property {'active'|'pending'|'ended'} relationshipStatus
 * @property {number} [since]
 * @property {string[]} contactMethods  subset of CONTACT_ACTIONS actually available
 * @property {boolean} shareInsights  homeowner consent to share air insights
 */
