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
  "friend_request",
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
  "poll_started",
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
  "friend_request",
  "suggestion_received",
  "poll_started",
  "rsvp_nudge",
] as const satisfies readonly NotificationKind[];

const actionableSet: ReadonlySet<string> = new Set(ACTIONABLE_KINDS);

export const isActionable = (kind: NotificationKind): boolean =>
  actionableSet.has(kind);

// --- what reaches the lock screen -------------------------------------------
//
// Two different questions, and conflating them is how notification settings
// become a wall of switches. Which INBOX something belongs to is decided above
// and is not a preference. Whether it is worth interrupting somebody for is
// decided here, and is.

/**
 * The choices offered, in the order they appear.
 *
 * Grouped rather than one switch per kind: fifteen switches is a settings
 * screen nobody reads, and the kinds inside each group genuinely rise and fall
 * together. Somebody who wants to know about invitations wants to know about
 * all three sorts of invitation.
 */
export const NOTIFY_GROUPS = [
  "invitations",
  "events",
  "picking_times",
  "rsvps",
  "joining",
  "changes",
] as const;

export type NotifyGroup = (typeof NOTIFY_GROUPS)[number];

/**
 * Every kind has a group. The mapping is total on purpose: a `Record` keyed by
 * the union means adding a notification kind without deciding whether it is
 * worth waking somebody up for is a type error rather than a silent default.
 */
export const GROUP_FOR: Record<NotificationKind, NotifyGroup> = {
  invite_pending: "invitations",
  friend_request: "invitations",
  join_request: "invitations",

  event_added: "events",
  poll_started: "picking_times",
  rsvp_nudge: "rsvps",
  joined_via_link: "joining",

  event_cancelled: "changes",
  event_deleted_by_owner: "changes",
  suggestion_received: "changes",
  suggestion_accepted: "changes",
  suggestion_rejected: "changes",
  removed_from_calendar: "changes",
  ownership_granted: "changes",
  ownership_revoked: "changes",
  calendar_deleted: "changes",
};

export const groupFor = (kind: NotificationKind): NotifyGroup => GROUP_FOR[kind];

export interface NotifyPrefs {
  /** The master switch. Off means nothing reaches the lock screen at all. */
  readonly enabled: boolean;
  /** Groups that are switched OFF. Absence means on, so a new group arrives on. */
  readonly muted: readonly NotifyGroup[];
  /** How long before an event to say something. Empty means no reminders. */
  readonly remindAt: readonly ReminderOffset[];
}

export type ReminderOffset = "start" | "1h" | "1d";

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: true,
  muted: [],
  // One hour is the only default that is useful without being intrusive: at the
  // start is too late to leave the house, and a day before is a reminder about
  // a reminder for most things.
  remindAt: ["1h"],
};

/**
 * Whether something is worth interrupting for.
 *
 * Muted rather than chosen, so that a kind added in a later version reaches
 * people instead of being silently withheld from everybody who saved their
 * preferences before it existed.
 */
export function notifies(prefs: NotifyPrefs, kind: NotificationKind): boolean {
  return prefs.enabled && !prefs.muted.includes(groupFor(kind));
}
