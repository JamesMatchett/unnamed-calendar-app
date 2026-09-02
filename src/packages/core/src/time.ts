/**
 * Time handling. See Architecture.md §5.5.
 *
 * Every event stores THREE things, and the reason is that "7pm at the venue" and
 * "18:00 UTC" diverge the moment a DST boundary or a trip abroad is involved —
 * which, for a holiday and festival app, is most of the time.
 */

/** '2026-09-02T18:30:00.000Z' — an absolute instant. */
export type Instant = string;

/** '2026-09-02T19:30:00' — wall-clock time with no offset. */
export type LocalDateTime = string;

/** '2026-09-02' */
export type IsoDate = string;

/** 'Europe/London'. IANA, never a fixed offset — offsets change twice a year. */
export type TimeZoneId = string;

/**
 * Not every event has a time. "Saturday, beach day, time TBC" is a real and
 * common entry in a group calendar, and forcing it to 00:00 is wrong.
 */
export type TimePrecision = "datetime" | "date" | "tbc";

export interface EventTime {
  /** Absolute instant. Present even when precision is 'date' (midnight in tz). */
  readonly startUtc: Instant;
  readonly endUtc?: Instant;
  /** The zone the event happens in — defaults to the calendar's, not the phone's. */
  readonly tz: TimeZoneId;
  /** What the organiser actually typed, preserved across DST and travel. */
  readonly localWall: LocalDateTime;
  readonly precision: TimePrecision;
}

/**
 * RFC 5545 recurrence rule, e.g. 'FREQ=WEEKLY;BYDAY=TU'.
 *
 * Stored as a string on the series master and expanded ON THE CLIENT — never
 * materialised into rows. Expanded instances in the database are unbounded and a
 * migration nightmare.
 */
export type RRuleString = string;

/**
 * Open-ended rules are expanded no further than this, so agenda queries
 * terminate. §5.5.
 */
export const RECURRENCE_HORIZON_YEARS = 2;

/**
 * DynamoDB TTL requires **epoch SECONDS**. Passing milliseconds is the classic
 * way to set an expiry roughly 50,000 years out and wonder why nothing is ever
 * cleaned up.
 */
export type EpochSeconds = number;

export const toEpochSeconds = (d: Date): EpochSeconds =>
  Math.floor(d.getTime() / 1000);

export const daysFromNow = (days: number): EpochSeconds =>
  toEpochSeconds(new Date(Date.now() + days * 86_400_000));

/** Retention windows, all writing to the single `expiresAt` attribute. */
export const RETENTION_DAYS = {
  /** §5.1 — bounds the change log and defines the 410 full-resync threshold. */
  changeLog: 90,
  /** §5.4 — matched to the change log so offline clients always converge. */
  tombstone: 90,
  /** §8.5 — restorable soft delete. */
  deletedCalendar: 30,
  /** §7.3 */
  notification: 90,
} as const;
