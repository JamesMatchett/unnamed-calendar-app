/**
 * Undoing things (§8.4).
 *
 * The app had many ways to create and none to tidy up: an event could be
 * called off but not removed, a calendar joined but not left, a member invited
 * but not shown the door. These are the rules for the reverse direction. Pure,
 * so both clients and the API refuse the same things for the same reasons.
 */

export type Role = "owner" | "member";

/**
 * What removing an event means right now (§8.2).
 *
 * Deleting is a two-step in a shared calendar: call it off first, so the
 * people organised around it are told, then remove it. That is the existing
 * rule in membership.ts and this does not soften it. The exception is a
 * calendar of one, where there is nobody to tell and the two-step is just two
 * taps: there, removing is one step.
 */
export function deleteStep({
  status,
  solo,
  allowed,
}: {
  status: "active" | "cancelled";
  /** Nobody else is in the calendar. */
  solo: boolean;
  /** May this person edit the event at all? */
  allowed: boolean;
}): "none" | "cancel_first" | "delete" {
  if (!allowed) return "none";
  if (solo) return "delete";
  return status === "cancelled" ? "delete" : "cancel_first";
}

/**
 * Whether this person may leave this calendar.
 *
 * The last owner cannot leave: a calendar with nobody able to change its
 * settings, approve a join or remove a member is stuck for everyone else in it.
 * They delete it, or make somebody else an owner first. A calendar of one
 * person is that person's own plans, which is not a thing you leave.
 */
export function canLeaveCalendar({
  role,
  ownerCount,
  memberCount,
}: {
  role: Role | null;
  /** Active owners, including this person if they are one. */
  ownerCount: number;
  /** Active members, including this person. */
  memberCount: number;
}): { ok: true } | { ok: false; reason: "not_member" | "last_owner" | "alone" } {
  if (role === null) return { ok: false, reason: "not_member" };
  if (memberCount <= 1) return { ok: false, reason: "alone" };
  if (role === "owner" && ownerCount <= 1) return { ok: false, reason: "last_owner" };
  return { ok: true };
}

/**
 * Whether one person may remove another.
 *
 * Owners remove members. Owners do not remove owners: two people with equal
 * standing removing each other is a fight the software should not referee, and
 * the way past it is for one of them to step down first. Nobody removes
 * themselves here, because that is leaving and has its own rule.
 */
export function canRemoveMember({
  myRole,
  theirRole,
  isSelf,
}: {
  myRole: Role | null;
  theirRole: Role;
  isSelf: boolean;
}): boolean {
  if (isSelf) return false;
  if (myRole !== "owner") return false;
  return theirRole !== "owner";
}

/** Only an owner deletes a calendar, and never the one that is their own plans. */
export function canDeleteCalendar({
  role,
  isOwnPlans,
}: {
  role: Role | null;
  isOwnPlans: boolean;
}): boolean {
  return role === "owner" && !isOwnPlans;
}
