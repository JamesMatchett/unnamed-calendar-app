/**
 * Who is around on a given day. Architecture.md §4.3 (`collectAvailability`).
 *
 * An arrival is not an event: nobody RSVPs to a flight landing, and putting it
 * in the event list buries the actual information — that three people are here
 * and two are not — inside something shaped like a dinner reservation. It is a
 * fact about presence, so it gets its own representation.
 *
 * Pure, so both clients classify identically and the rules can be tested.
 */

import type { TravelMode } from "./entities.js";
import type { Instant } from "./time.js";

export interface PresenceInput {
  readonly userId: string;
  readonly displayName: string;
  readonly arrivesAt?: Instant | null;
  readonly departsAt?: Instant | null;
  /**
   * How this person is travelling, when they have said. `null` means they are
   * following whatever the calendar says — which is not the same as having
   * chosen the same thing, because if the organiser later changes the group's
   * mode, the people who never chose should follow it.
   */
  readonly travelMode?: TravelMode | null;
}

export interface DayPresence {
  /** Arrived before today and not yet gone. */
  readonly here: readonly PresenceInput[];
  readonly arrivingToday: readonly PresenceInput[];
  readonly leavingToday: readonly PresenceInput[];
  /** Arriving after today. */
  readonly stillToCome: readonly PresenceInput[];
  readonly alreadyGone: readonly PresenceInput[];
  /** Has not said when they are coming or going. */
  readonly unknown: readonly PresenceInput[];
}

/**
 * `dayStart` and `dayEnd` are the instants bounding the day **in the calendar's
 * timezone** — the caller resolves that, because "which day is it" is a
 * presentation question and the answer differs by where the trip is (§5.5).
 *
 * Someone arriving and leaving on the same day appears in both lists: that is
 * genuinely two facts about them, and collapsing it would hide one.
 */
export function classifyPresence(
  people: readonly PresenceInput[],
  dayStart: Instant,
  dayEnd: Instant,
): DayPresence {
  const here: PresenceInput[] = [];
  const arrivingToday: PresenceInput[] = [];
  const leavingToday: PresenceInput[] = [];
  const stillToCome: PresenceInput[] = [];
  const alreadyGone: PresenceInput[] = [];
  const unknown: PresenceInput[] = [];

  for (const p of people) {
    const arrives = p.arrivesAt ?? null;
    const departs = p.departsAt ?? null;

    if (arrives === null && departs === null) {
      unknown.push(p);
      continue;
    }

    const arrivesToday = arrives !== null && arrives >= dayStart && arrives < dayEnd;
    const leavesToday = departs !== null && departs >= dayStart && departs < dayEnd;

    if (arrivesToday) arrivingToday.push(p);
    if (leavesToday) leavingToday.push(p);
    if (arrivesToday || leavesToday) continue;

    if (departs !== null && departs < dayStart) {
      alreadyGone.push(p);
      continue;
    }

    if (arrives !== null && arrives >= dayEnd) {
      stillToCome.push(p);
      continue;
    }

    // Arrived earlier, not yet gone — or only ever said when they leave, which
    // still implies being here until then.
    here.push(p);
  }

  return { here, arrivingToday, leavingToday, stillToCome, alreadyGone, unknown };
}

/** How many people the day concerns at all, for a "3 of 5 are here" summary. */
export const presenceTotal = (p: DayPresence): number =>
  p.here.length +
  p.arrivingToday.length +
  p.stillToCome.length +
  p.alreadyGone.length +
  p.unknown.length;

/**
 * The icon for a group of people: theirs when they agree, the calendar's when
 * they do not. Showing a plane over a row containing someone who is driving is
 * exactly the small wrongness the per-person override exists to remove.
 */
export function sharedTravelMode(
  people: readonly PresenceInput[],
  fallback: TravelMode,
): TravelMode {
  const modes = new Set(people.map((p) => p.travelMode ?? fallback));
  if (modes.size !== 1) return fallback;
  const [only] = [...modes];
  return only ?? fallback;
}
