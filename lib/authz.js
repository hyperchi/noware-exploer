/* Roles and authorization, enforced at the data layer.
 *
 *   homeowner  - member of a household: full read/write on that household
 *   contractor - staff of a contractor: read-only on households that have an
 *                active relationship with that contractor AND have consented
 *                to share insights; may update their own signal statuses and
 *                record service events
 *   admin      - emails listed in ADMIN_EMAILS (none by default)
 *
 *   team       - verified @noso.so accounts: read-only on the household that
 *                holds the shared office cube (TEAM_DEVICE_KEYS). Other homes
 *                stay private to their members.
 *
 * Every API handler calls one of these with the store, never a UI flag.
 */
import { ALLOWED_DOMAIN } from './auth-policy.js';

// The office cube, by its documented gateway key and its USB serial identity.
const DEFAULT_TEAM_DEVICE_KEYS = 'aircube-office,usb:74:4D:BD:69:0C:9F';

// Coarse area for the outdoor comparison; the store may not survive a restart.
export const TEAM_OFFICE_LOCATION = { latitude: 37.8, longitude: -122.4, label: 'San Francisco, CA 94107', precision: 'area', enabled: true };

// Caltrans cameras closest to the office. The stored area is too coarse to pick them.
export const TEAM_OFFICE_CAMERAS = ['TVD01', 'TVD22'];

export function teamDeviceKeys(env = process.env) {
  return (env.TEAM_DEVICE_KEYS ?? DEFAULT_TEAM_DEVICE_KEYS).split(',').map((k) => k.trim()).filter(Boolean);
}

export const isTeamEmail = (email) => typeof email === 'string' && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);

/** May this account publish this device even though it is not a household member? */
export function canPublishTeamDevice(deviceKey, email, env = process.env) {
  return isTeamEmail(email) && teamDeviceKeys(env).includes(deviceKey);
}

function teamHouseholdIds(email, store, env) {
  if (!isTeamEmail(email)) return [];
  const ids = new Set();
  for (const key of teamDeviceKeys(env)) {
    const household = store.householdOfDevice(key);
    if (household) ids.add(household.id);
  }
  return [...ids];
}

export function principalFor(session, store, { env = process.env } = {}) {
  const email = (session?.email || '').toLowerCase();
  if (!email) return null;
  const admins = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const households = store.householdsForMember(email);
  const contractors = store.contractorsForMember(email);
  const roles = [];
  if (households.length) roles.push('homeowner');
  if (contractors.length) roles.push('contractor');
  if (admins.includes(email)) roles.push('admin');
  return {
    email,
    name: session.name || email.split('@')[0],
    roles,
    isAdmin: roles.includes('admin'),
    householdIds: households.map((h) => h.id),
    contractorIds: contractors.map((c) => c.id),
    teamHouseholdIds: teamHouseholdIds(email, store, env),
  };
}

export function canViewHousehold(principal, householdId, store) {
  if (!principal) return false;
  if (principal.isAdmin || principal.householdIds.includes(householdId) || principal.teamHouseholdIds?.includes(householdId)) return true;
  const assignment = store.assignmentFor(householdId);
  return Boolean(assignment && assignment.shareInsights && principal.contractorIds.includes(assignment.contractorId));
}

export function canEditHousehold(principal, householdId) {
  return Boolean(principal && (principal.isAdmin || principal.householdIds.includes(householdId)));
}

export function canActAsContractor(principal, contractorId) {
  return Boolean(principal && (principal.isAdmin || principal.contractorIds.includes(contractorId)));
}

/** Households visible to a contractor principal across all of their companies. */
export function contractorHouseholds(principal, store) {
  if (!principal) return [];
  const ids = principal.isAdmin ? Object.values(store.state.contractors).map((c) => c.id) : principal.contractorIds;
  const seen = new Map();
  for (const id of ids) for (const h of store.householdsForContractor(id)) seen.set(h.id, { household: h, contractorId: id });
  return [...seen.values()];
}

export function isTeamViewer(principal, householdId) {
  return Boolean(principal?.teamHouseholdIds?.includes(householdId) && !canEditHousehold(principal, householdId));
}

/** The subset of a household a contractor is allowed to see. */
export function contractorViewOfHousehold(h) {
  return {
    id: h.id,
    name: h.name,
    timeZone: h.timeZone || null,
    rooms: h.rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, deviceCount: (r.deviceKeys || []).length })),
    equipment: h.equipment,
    profile: { concerns: h.profile?.concerns || {}, sensitivities: { allergies: Boolean(h.profile?.sensitivities?.allergies), asthma: Boolean(h.profile?.sensitivities?.asthma) }, pets: { hasPets: Boolean(h.profile?.pets?.hasPets) } },
  };
}
