/**
 * Every key shape in the single table, in one place.
 *
 * Architecture.md §4.2 is the specification; this module is the only code that
 * should ever concatenate a key by hand. The base table's PK/SK are a one-way
 * door — they cannot be changed on a live table — so a typo here is expensive in
 * a way a typo elsewhere is not.
 */

import type {
  ArtistId,
  CalendarId,
  CognitoSub,
  EventId,
  FestivalId,
  FestivalSessionId,
  NotificationId,
  SuggestionId,
  UserId,
} from "./ids.js";
import type { Instant } from "./time.js";

export const KEY_PREFIX = {
  user: "USER#",
  calendar: "CAL#",
  invite: "INVITE#",
  pending: "PENDING#",
  festival: "FEST#",
  artist: "ARTIST#",
  artistAlias: "ARTISTALIAS#",
  identity: "IDENTITY#",
} as const;

export const GSI1 = "GSI1" as const;

/** Change-log sequence numbers are zero-padded so that SK ordering is numeric. */
const SEQ_WIDTH = 12;
export const padSeq = (seq: number): string =>
  String(seq).padStart(SEQ_WIDTH, "0");

/**
 * The occurrence component of an RSVP key (§5.5).
 *
 * A real occurrence is its ORIGINAL start instant — RFC 5545's RECURRENCE-ID —
 * so that moving an occurrence does not orphan the RSVPs attached to it.
 * `SERIES_DEFAULT` marks the "all upcoming" answer, and is also what a
 * non-recurring event uses: one series, no occurrences to override. That is why
 * every RSVP in the system has one key shape.
 */
export const SERIES_DEFAULT = "-" as const;
export type OccurrenceKey = Instant | typeof SERIES_DEFAULT;

// --- partition keys --------------------------------------------------------

export const userPk = (userId: UserId) => `${KEY_PREFIX.user}${userId}`;
export const calendarPk = (calendarId: CalendarId) =>
  `${KEY_PREFIX.calendar}${calendarId}`;
export const festivalPk = (festivalId: FestivalId) =>
  `${KEY_PREFIX.festival}${festivalId}`;
export const artistPk = (artistId: ArtistId) =>
  `${KEY_PREFIX.artist}${artistId}`;

/** Invites are keyed by the token's hash, never the token (§7). */
export const invitePk = (tokenSha256: string) =>
  `${KEY_PREFIX.invite}${tokenSha256}`;

/**
 * Invites addressed to someone who has not signed up yet, keyed by a hash of the
 * lowercased email — so the table never accumulates a plaintext list of
 * addresses belonging to people who never joined (§7.1).
 */
export const pendingInvitePk = (emailSha256: string) =>
  `${KEY_PREFIX.pending}${emailSha256}`;

/** Maps a Cognito sub to our own ULID user id (§3.2). */
export const identityPk = (sub: CognitoSub) =>
  `${KEY_PREFIX.identity}${sub}`;

/** Normalised-name alias that resolves to a canonical artist (§6.6). */
export const artistAliasPk = (slug: string) =>
  `${KEY_PREFIX.artistAlias}${slug}`;

// --- sort keys -------------------------------------------------------------

export const SK = {
  meta: () => "META",
  profile: () => "PROFILE",

  member: (userId: UserId) => `MEMBER#${userId}`,
  event: (eventId: EventId) => `EVENT#${eventId}`,
  rsvp: (eventId: EventId, occ: OccurrenceKey, userId: UserId) =>
    `RSVP#${eventId}#${occ}#${userId}`,
  suggestion: (eventId: EventId, suggestionId: SuggestionId) =>
    `SUGG#${eventId}#${suggestionId}`,
  availability: (userId: UserId) => `AVAIL#${userId}`,
  change: (seq: number) => `CHG#${padSeq(seq)}`,
  joinRequest: (userId: UserId) => `JOINREQ#${userId}`,

  notification: (createdAt: Instant, id: NotificationId) =>
    `NOTIF#${createdAt}#${id}`,
  pendingInviteForUser: (calendarId: CalendarId) => `PENDINV#${calendarId}`,
  pendingInviteForEmail: (calendarId: CalendarId) => `INV#${calendarId}`,

  festivalSession: (sessionId: FestivalSessionId) => `SESS#${sessionId}`,
} as const;

// --- prefixes for begins_with queries --------------------------------------

export const SK_PREFIX = {
  member: "MEMBER#",
  event: "EVENT#",
  rsvp: "RSVP#",
  suggestion: "SUGG#",
  availability: "AVAIL#",
  change: "CHG#",
  joinRequest: "JOINREQ#",
  notification: "NOTIF#",
  pendingInviteForUser: "PENDINV#",
  festivalSession: "SESS#",
  /** Access pattern 6: every answer for one occurrence of one event. */
  rsvpForOccurrence: (eventId: EventId, occ: OccurrenceKey) =>
    `RSVP#${eventId}#${occ}#`,
  /** Every answer for an event, across all occurrences. */
  rsvpForEvent: (eventId: EventId) => `RSVP#${eventId}#`,
  suggestionsForEvent: (eventId: EventId) => `SUGG#${eventId}#`,
} as const;

// --- GSI1 ------------------------------------------------------------------

/**
 * GSI1 is sparse. Omitting GSI1PK/GSI1SK removes an item from the index without
 * deleting it — which is exactly how a departed member's calendar drops out of
 * their list while the membership item survives for name resolution (§8.4).
 */
export const GSI1_KEYS = {
  /** Pattern 1: which calendars am I in? */
  membership: (userId: UserId, calendarId: CalendarId) => ({
    GSI1PK: userPk(userId),
    GSI1SK: calendarPk(calendarId),
  }),

  /**
   * Pattern 4: one-off events, ordered by start time within a calendar.
   * Only for events WITHOUT an rrule — see `eventSeries` for why.
   */
  eventAtTime: (calendarId: CalendarId, startUtc: Instant, eventId: EventId) => ({
    GSI1PK: calendarPk(calendarId),
    GSI1SK: `T#${startUtc}#${eventId}`,
  }),

  /**
   * Pattern 17: recurring series.
   *
   * A series is ONE item with ONE start time, so a weekly event that began in
   * March is invisible to a date-window query for next week. Series therefore
   * sort under their own prefix and are always fetched whole, then expanded on
   * the client (§5.5). Getting this wrong produces a bug that only appears for
   * users who scroll far enough forward.
   */
  eventSeries: (calendarId: CalendarId, eventId: EventId) => ({
    GSI1PK: calendarPk(calendarId),
    GSI1SK: `SERIES#${eventId}`,
  }),

  /** Pattern 13: my upcoming events across every calendar. */
  rsvp: (userId: UserId, startUtc: Instant, calendarId: CalendarId) => ({
    GSI1PK: userPk(userId),
    GSI1SK: `RSVP#${startUtc}#${calendarId}`,
  }),

  /** Pattern 16 by user: join requests I have outstanding. */
  joinRequest: (userId: UserId, calendarId: CalendarId) => ({
    GSI1PK: userPk(userId),
    GSI1SK: `JOINREQ#${calendarId}`,
  }),
} as const;

export const GSI1_SK_PREFIX = {
  calendarsForUser: KEY_PREFIX.calendar,
  rsvpsForUser: "RSVP#",
  seriesInCalendar: "SERIES#",
  /** Inclusive lower bound for a date-window query. */
  eventsFrom: (from: Instant) => `T#${from}`,
  /** Exclusive-ish upper bound; `￿` sorts after any id suffix. */
  eventsTo: (to: Instant) => `T#${to}￿`,
} as const;
