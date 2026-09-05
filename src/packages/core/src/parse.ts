/**
 * Natural-language event entry. Architecture.md §3.5.
 *
 * "Drinks at The Crown Thursday 8pm" becomes a title, a date, a time and a
 * place. This is the single biggest lever on how many events get created, and
 * every field a person has to fill in by hand costs completions.
 *
 * Deliberately hand-written rather than pulling in a parsing library: it runs on
 * device with no dependency, and — more importantly — it is small enough to be
 * exhaustively tested, which matters for something that silently guesses.
 *
 * Nothing here is authoritative. The parse populates a form the person then
 * sees and corrects; a wrong guess costs a tap, not a wrong event.
 */

import { addDays, todayIn } from "./zones.js";

export interface ParsedEvent {
  readonly title: string;
  /** YYYY-MM-DD, when a day could be read. */
  readonly date: string | null;
  /** HH:MM (24h), when a time could be read. */
  readonly time: string | null;
  readonly location: string | null;
  /**
   * How exact the timing is, when the text SAYS so — "all day", "TBC".
   *
   * `null` means nothing was stated, which is different from "datetime": it
   * leaves whatever the form already had alone, so a parse never quietly
   * overrides a choice someone made by hand.
   */
  readonly precision: "datetime" | "date" | "tbc" | null;
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

interface Match {
  readonly start: number;
  readonly end: number;
}

export function parseEventText(
  text: string,
  tz: string,
  now: Date = new Date(),
): ParsedEvent {
  const today = todayIn(tz, now);
  const consumed: Match[] = [];

  // Precision first: "all day" contains no time, but "TBC" must be taken out of
  // the string before the location matcher can mistake it for a place.
  const precision = matchPrecision(text, consumed);
  const time = precision === null ? matchTime(text, consumed) : null;
  const date = matchDate(text, today, consumed);
  const location = matchLocation(text, consumed);

  return {
    title: cleanTitle(strip(text, consumed)),
    date,
    time,
    location,
    precision: precision ?? (time === null ? null : "datetime"),
  };
}

// --- precision -------------------------------------------------------------

/**
 * "all day" and "TBC" are how people write timing they cannot pin down, and both
 * are states the app already models. Reading them from the text saves a trip to
 * the segmented control, and — more to the point — stops the words surviving
 * into the title, where "Beach club trip on all day" is what you get instead of
 * "Beach club trip".
 */
function matchPrecision(
  text: string,
  consumed: Match[],
): "date" | "tbc" | null {
  // A leading "on"/"at" is swallowed with the phrase, or "trip on all day"
  // leaves a dangling preposition mid-sentence.
  const allDay = /\b(?:on\s+|for\s+)?all[\s-]?day\b/i.exec(text);
  if (allDay) {
    consumed.push({ start: allDay.index, end: allDay.index + allDay[0].length });
    return "date";
  }

  // "tbc", "tba", "tbd", and the same with "time" in front of them.
  const tbc = /\b(?:time\s+)?(?:is\s+)?tb[cad]\b\.?/i.exec(text);
  if (tbc) {
    consumed.push({ start: tbc.index, end: tbc.index + tbc[0].length });
    return "tbc";
  }

  return null;
}

// --- time ------------------------------------------------------------------

function matchTime(text: string, consumed: Match[]): string | null {
  // "8pm", "8.30pm", "8:30 pm", "at 7", "19:45". The optional "at" is consumed
  // with the time so it does not survive into the title.
  const re =
    /\b(?:at\s+)?(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?\b(?!\s*(?:st|nd|rd|th|\/|-))/gi;

  for (const m of text.matchAll(re)) {
    const hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const meridiem = m[3]?.toLowerCase();

    // A bare number with no am/pm and no colon is far more likely to be part of
    // the title ("5 a side", "Studio 54") than a time.
    if (!meridiem && !m[2]) continue;
    if (hour > 23 || minute > 59) continue;
    if (meridiem && hour > 12) continue;

    let h = hour;
    if (meridiem === "pm" && hour < 12) h += 12;
    if (meridiem === "am" && hour === 12) h = 0;

    consumed.push({ start: m.index, end: m.index + m[0].length });
    return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  // "tonight" implies an evening without naming one.
  const tonight = /\btonight\b/i.exec(text);
  if (tonight) return "19:00";

  return null;
}

// --- date ------------------------------------------------------------------

function matchDate(text: string, today: string, consumed: Match[]): string | null {
  const relative = /\b(today|tonight|tomorrow)\b/i.exec(text);
  if (relative) {
    const word = relative[1]?.toLowerCase() ?? "";
    consumed.push({ start: relative.index, end: relative.index + relative[0].length });
    return word === "tomorrow" ? addDays(today, 1) : today;
  }

  // "Thursday", "next Thursday". Bare weekday means the next one to come,
  // treating today as already gone: "drinks Thursday" said on a Thursday almost
  // always means the following week.
  const weekday = new RegExp(`\\b(next\\s+)?(${WEEKDAYS.join("|")})\\b`, "i").exec(text);
  if (weekday) {
    const target = WEEKDAYS.indexOf((weekday[2] ?? "").toLowerCase());
    const current = new Date(`${today}T12:00:00.000Z`).getUTCDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    if (weekday[1]) delta += 7;
    consumed.push({ start: weekday.index, end: weekday.index + weekday[0].length });
    return addDays(today, delta);
  }

  // "14 Oct", "14th October", "Oct 14".
  const dayMonth = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.map((m) => `${m.slice(0, 3)}[a-z]*`).join("|")})\\b`,
    "i",
  ).exec(text);
  const monthDay = new RegExp(
    `\\b(${MONTHS.map((m) => `${m.slice(0, 3)}[a-z]*`).join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "i",
  ).exec(text);

  const explicit = dayMonth
    ? { day: Number(dayMonth[1]), month: dayMonth[2], m: dayMonth }
    : monthDay
      ? { day: Number(monthDay[2]), month: monthDay[1], m: monthDay }
      : null;

  if (explicit) {
    const monthIndex = MONTHS.findIndex((name) =>
      name.startsWith((explicit.month ?? "").slice(0, 3).toLowerCase()),
    );
    if (monthIndex >= 0 && explicit.day >= 1 && explicit.day <= 31) {
      const year = Number(today.slice(0, 4));
      const candidate = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(explicit.day).padStart(2, "0")}`;
      consumed.push({
        start: explicit.m.index,
        end: explicit.m.index + explicit.m[0].length,
      });
      // A date already past this year means next year: nobody schedules
      // backwards.
      return candidate < today
        ? `${year + 1}${candidate.slice(4)}`
        : candidate;
    }
  }

  return null;
}

// --- location --------------------------------------------------------------

function matchLocation(text: string, consumed: Match[]): string | null {
  // "at The Crown", "@ EartH". Stops at a time or date word so "at The Crown
  // Thursday" does not swallow the day.
  // `\b` cannot precede "@": a space and an "@" are both non-word characters, so
  // there is no boundary between them. The alternation anchors each separately.
  const re = /(?:\bat\b|@)\s+(.+?)(?=\s+(?:on|tomorrow|today|tonight|next|\d)|$)/i;
  const m = re.exec(text);
  if (!m) return null;

  // Skip when the "at" was part of a time ("at 8pm"), which is already consumed.
  const start = m.index;
  if (consumed.some((c) => start >= c.start && start < c.end)) return null;

  const value = (m[1] ?? "").trim();
  if (value.length === 0) return null;

  // Stop at anything already claimed by another matcher. Without this, "at the
  // villa, time TBC" reads the whole tail as the place: the location matcher is
  // greedy by design, and "TBC" was consumed before it ran.
  const valueStart = m.index + m[0].indexOf(value);
  const claimed = consumed
    .filter((c) => c.start > valueStart && c.start < valueStart + value.length)
    .sort((a, b) => a.start - b.start)[0];

  const upToClaimed = claimed
    ? value.slice(0, claimed.start - valueStart)
    : value;

  const weekdayInside = new RegExp(`\\b(${WEEKDAYS.join("|")})\\b`, "i").exec(
    upToClaimed,
  );
  const trimmed = (
    weekdayInside ? upToClaimed.slice(0, weekdayInside.index) : upToClaimed
  )
    .trim()
    .replace(/[,;]\s*$/, "");
  if (trimmed.length === 0) return null;

  consumed.push({ start, end: valueStart + trimmed.length });
  return trimmed;
}

// --- leftovers become the title --------------------------------------------

function strip(text: string, consumed: Match[]): string {
  const ordered = [...consumed].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const { start, end } of ordered) {
    if (start < cursor) continue;
    out += text.slice(cursor, start);
    cursor = end;
  }
  return out + text.slice(cursor);
}

function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .replace(/\s*[,;]\s*$/, "")
    .replace(/\b(on|at|@|from)\s*$/i, "")
    .trim();

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
