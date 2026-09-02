/**
 * Which inbox a notification belongs to. Architecture.md §7.3, §3.5.
 *
 * The app has two surfaces, and they are not two feeds:
 *
 *   People   — a DESTINATION. Who you are connected to, who wants to connect,
 *              what you have been invited to. Things that need an answer and
 *              stay live until you give one.
 *   Activity — a FEED. What is happening in calendars you are already in.
 *              Ambient, and stale within a day.
 *
 * The dividing line is **relationship versus content**: anything that changes
 * who belongs to what is People; anything about events inside a calendar you are
 * already in is Activity. Encoded here so both surfaces cannot disagree about
 * where something belongs.
 */

import type { NotificationKind } from "./entities.js";

export const PEOPLE_NOTIFICATION_KINDS = [
  "invite_pending",
  "join_request",
  "joined_via_link",
  "removed_from_calendar",
  "ownership_granted",
  "ownership_revoked",
  "calendar_deleted",
] as const satisfies readonly NotificationKind[];

export const ACTIVITY_NOTIFICATION_KINDS = [
  "event_added",
  "event_cancelled",
  "event_deleted_by_owner",
  "suggestion_received",
  "suggestion_accepted",
  "suggestion_rejected",
  "rsvp_nudge",
] as const satisfies readonly NotificationKind[];

export type NotificationSurface = "people" | "activity";

const peopleSet: ReadonlySet<string> = new Set(PEOPLE_NOTIFICATION_KINDS);

export const surfaceFor = (kind: NotificationKind): NotificationSurface =>
  peopleSet.has(kind) ? "people" : "activity";

/**
 * Whether an item is waiting on the user to do something, as opposed to merely
 * informing them. Actionable items sort to the top of their surface and are what
 * the badge counts — a badge that counts ambient news trains people to ignore it.
 */
export const ACTIONABLE_KINDS = [
  "invite_pending",
  "join_request",
  "suggestion_received",
  "rsvp_nudge",
] as const satisfies readonly NotificationKind[];

const actionableSet: ReadonlySet<string> = new Set(ACTIONABLE_KINDS);

export const isActionable = (kind: NotificationKind): boolean =>
  actionableSet.has(kind);
