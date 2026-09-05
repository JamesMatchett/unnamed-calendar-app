/**
 * Authorisation rules, in one place so no handler reimplements them.
 * Architecture.md §4.5, §8.1, §8.3, §8.4.
 */

import type { CalendarItem, EventItem, MembershipItem } from "./entities.js";
import type { UserId } from "./ids.js";

/**
 * THE authorisation predicate. Membership items are soft-deleted, so presence in
 * the table is not permission — a former member's item is still there so their
 * name resolves on events they created. Testing existence instead of status
 * leaves every departed member with full access (§4.5).
 */
export const isActiveMember = (m: MembershipItem | undefined | null): boolean =>
  m?.status === "active";

export const isOwner = (m: MembershipItem | undefined | null): boolean =>
  isActiveMember(m) && m?.role === "owner";

/**
 * Ownership is flat: any owner may demote any other owner, including whoever
 * created the calendar. Promotion is therefore a full transfer of control, and
 * the UI should say so at that moment (§8.3).
 */
export const canManageRoles = isOwner;

/**
 * Adding events. Owners always can; members can unless the calendar has been set
 * to curated (§4.3, `allowMemberEvents`).
 *
 * This is a different question from editing an existing event: contributing to a
 * calendar and changing someone else's contribution are separate permissions.
 */
export const canCreateEvent = (
  calendar: Pick<CalendarItem, "allowMemberEvents">,
  actor: MembershipItem | undefined | null,
): boolean => {
  if (!isActiveMember(actor)) return false;
  return isOwner(actor) || calendar.allowMemberEvents;
};

/**
 * Direct edits. Owners may change anything; the author may change their own.
 * Everyone else goes through a suggestion — and when the author has disabled
 * suggestions, other members can neither suggest nor edit.
 */
export const canEditEventDirectly = (
  event: EventItem,
  actor: MembershipItem | undefined | null,
): boolean => {
  if (!isActiveMember(actor) || !actor) return false;
  return isOwner(actor) || event.createdBy === actor.userId;
};

export const canSuggestChange = (
  event: EventItem,
  actor: MembershipItem | undefined | null,
): boolean => {
  if (!isActiveMember(actor) || !actor) return false;
  if (canEditEventDirectly(event, actor)) return false; // they would just edit
  return event.allowSuggestions;
};

/**
 * The event author ALONE approves suggestions. A calendar owner does not approve
 * other people's — they make the edit themselves, which is the escape hatch when
 * an author has gone quiet and suggestions are rotting (§8.1).
 */
export const canApproveSuggestion = (
  event: EventItem,
  actorId: UserId,
): boolean => event.createdBy === actorId;

/** Cancelling is available to the author and to any owner (§8.2). */
export const canCancelEvent = canEditEventDirectly;

/**
 * Deleting is gated on the event already being cancelled — for owners too. That
 * two-step is what stops one tap destroying something several people organised
 * around (§8.2).
 */
export const canDeleteEvent = (
  event: EventItem,
  actor: MembershipItem | undefined | null,
): boolean => event.status === "cancelled" && canEditEventDirectly(event, actor);

/**
 * An orphaned event is frozen: with no active author, nobody can approve a
 * suggestion on it. Claiming reassigns authorship and unfreezes it (§8.4).
 */
export const canClaimEvent = (
  event: EventItem,
  authorMembership: MembershipItem | undefined | null,
  claimer: MembershipItem | undefined | null,
): boolean => !isActiveMember(authorMembership) && isOwner(claimer);

/**
 * Every joiner is approved when `requireApproval` is set — no exceptions, not
 * even for someone an owner invited directly. Sending an invite and admitting
 * the person who turns up are separate acts (§7.1).
 *
 * A previously removed user is forced through approval regardless of the
 * calendar's setting, so the owner decides at the door rather than reacting
 * afterwards (§8.4).
 */
export const joinNeedsApproval = (
  calendar: CalendarItem,
  priorMembership: MembershipItem | undefined | null,
): boolean => calendar.requireApproval || priorMembership?.wasRemoved === true;

export const canInvite = (
  calendar: CalendarItem,
  actor: MembershipItem | undefined | null,
): boolean =>
  isOwner(actor) || (isActiveMember(actor) && calendar.allowMemberInvites);

/**
 * An owner may leave freely while other owners remain. Only a departure that
 * would take the calendar to zero owners requires nominating a successor first
 * (§8.4).
 */
export const leavingWouldOrphan = (
  members: readonly MembershipItem[],
  leavingUserId: UserId,
): boolean =>
  members.filter((m) => isOwner(m) && m.userId !== leavingUserId).length === 0;
