/* Roles and authorization, enforced at the data layer.
 *
 *   homeowner  - member of a household: full read/write on that household
 *   contractor - staff of a contractor: read-only on households that have an
 *                active relationship with that contractor AND have consented
 *                to share insights; may update their own signal statuses and
 *                record service events
 *   admin      - emails listed in ADMIN_EMAILS (none by default)
 *
 * Every API handler calls one of these with the store, never a UI flag.
 */

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
  };
}

export function canViewHousehold(principal, householdId, store) {
  if (!principal) return false;
  if (principal.isAdmin || principal.householdIds.includes(householdId)) return true;
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
