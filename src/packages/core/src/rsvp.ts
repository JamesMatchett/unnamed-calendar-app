/**
 * Attendance resolution. Architecture.md §5.5.
 *
 * An answer may be attached to a single occurrence, or be the series default
 * that covers every occurrence from `effectiveFrom` onward. "All upcoming"
 * writes ONE item, never a fan-out across future occurrences: a fan-out is
 * unbounded against the recurrence horizon, queues a hundred writes on an
 * offline device, and still misses occurrences that do not exist yet.
 */

import type { RsvpAnswer, RsvpStatus, TicketStatus } from "./entities.js";
import { SERIES_DEFAULT } from "./keys.js";
import type { Instant } from "./time.js";

export type RsvpSource = "occurrence" | "series" | "none";

export interface ResolvedRsvp {
  readonly status: RsvpStatus | null;
  readonly source: RsvpSource;
  readonly item: RsvpAnswer | null;
}

const NO_ANSWER: ResolvedRsvp = { status: null, source: "none", item: null };

/**
 * Resolution order: an explicit answer for this occurrence always wins, however
 * long ago it was given. Otherwise the series default applies, but only from
 * `effectiveFrom` — so answering "all upcoming" today does not retroactively
 * claim you attended last month.
 *
 * Instants are compared as strings, which is safe only because they are all
 * normalised UTC ISO-8601 of identical width.
 */
export function resolveRsvp(
  occurrence: Instant,
  perOccurrence: RsvpAnswer | undefined | null,
  seriesDefault: RsvpAnswer | undefined | null,
): ResolvedRsvp {
  if (perOccurrence) {
    return {
      status: perOccurrence.status,
      source: "occurrence",
      item: perOccurrence,
    };
  }

  if (!seriesDefault) return NO_ANSWER;

  const from = seriesDefault.effectiveFrom;
  if (from !== undefined && occurrence < from) return NO_ANSWER;

  return { status: seriesDefault.status, source: "series", item: seriesDefault };
}

export const isSeriesDefault = (r: RsvpAnswer): boolean =>
  r.occurrence === SERIES_DEFAULT;

export interface TicketTally {
  readonly have: number;
  readonly looking: number;
  readonly none: number;
  /** Coming, but has not said anything about a ticket. */
  readonly unsaid: number;
}

export interface RsvpTally {
  readonly going: number;
  readonly maybe: number;
  readonly notGoing: number;
  /** Members with no resolvable answer. Absence of an item IS this state. */
  readonly noResponse: number;
  /**
   * Counted only among people who are coming. Someone who has said they cannot
   * make it does not need a ticket, and counting them as missing one would
   * inflate every number an organiser looks at.
   */
  readonly tickets: TicketTally;
}

/**
 * `noResponse` is why the tally takes the member count rather than deriving it:
 * "3 going, 2 maybe, 4 haven't replied" is what makes the nudge action possible,
 * and it cannot be computed from the answers alone (§3.5).
 */
export function tallyRsvps(
  resolved: readonly ResolvedRsvp[],
  memberCount: number,
): RsvpTally {
  let going = 0;
  let maybe = 0;
  let notGoing = 0;
  const tickets = { have: 0, looking: 0, none: 0, unsaid: 0 };

  for (const r of resolved) {
    if (r.status === "going") going += 1;
    else if (r.status === "maybe") maybe += 1;
    else if (r.status === "not_going") notGoing += 1;

    if (r.status === "going" || r.status === "maybe") {
      const ticket: TicketStatus | null = r.item?.ticketStatus ?? null;
      if (ticket === null) tickets.unsaid += 1;
      else tickets[ticket] += 1;
    }
  }

  const answered = going + maybe + notGoing;
  return {
    going,
    maybe,
    notGoing,
    noResponse: Math.max(0, memberCount - answered),
    tickets,
  };
}
