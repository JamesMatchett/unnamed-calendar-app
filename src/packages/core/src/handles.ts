/**
 * What a handle is allowed to be (§7.3).
 *
 * In core rather than in the app because a handle is now the thing a QR code
 * carries and a web page reads back, so the same rule has to hold in three
 * places: the field somebody types it into, the link the app builds, and the
 * screen a scan lands on. Three copies of a regular expression is how a code
 * that scans on one phone fails to resolve on another.
 *
 * The site's own copy, in site/add/index.html, is a fourth and cannot import
 * this one because it runs in a browser with no bundler. It is kept in step by
 * a test that parses the rule back out of the page and runs both against the
 * same inputs, which is the nearest thing to sharing that a static file allows.
 */

/** The longest a handle can be. Short enough to read off a screen aloud. */
export const HANDLE_MAX = 24;

/**
 * The shortest. Two-character handles are the ones people fight over, and a
 * handle is permanent enough to be worth a floor.
 */
export const HANDLE_MIN = 3;

export type HandleFault = "empty" | "too_short" | "taken";

/**
 * Why a handle cannot be used, or null if it can.
 *
 * Here rather than in each screen because there were two screens applying two
 * different rules to the same field: onboarding required three characters and
 * the profile screen required one, so a name you could not sign up with could
 * be set an hour later. Worse, only one of the two reasons had anything to say
 * for itself — a handle that was merely too short greyed the button out and
 * left the ordinary hint underneath it, which is a dead button with no
 * explanation, and somebody called Jo would hit it without typing anything at
 * all, because the suggestion from their own name is two letters long.
 *
 * Takes `taken` rather than looking it up: whether a handle is free is a
 * question for a database, and every other part of this is not.
 */
export function handleFault(raw: string, taken: boolean): HandleFault | null {
  const handle = normaliseHandle(raw);
  if (handle.length === 0) return "empty";
  if (handle.length < HANDLE_MIN) return "too_short";
  if (taken) return "taken";
  return null;
}

/**
 * Lower case, letters, digits, dots and underscores, no leading sigil.
 *
 * Both "&" and "@" are stripped from the front. "&" is ours; "@" is what
 * fingers do out of habit, and refusing it would be a rejection nobody can see
 * the reason for.
 *
 * Idempotent, which matters more than it looks: this runs on input, again when
 * a link is built, and again when one is opened, so normalising a normalised
 * handle has to be the same handle or a round trip changes who you are.
 */
export function normaliseHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^[&@]+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, HANDLE_MAX);
}

/** A first guess at a handle from a name: "Maya Okonkwo" -> "maya". */
export function suggestHandle(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  return normaliseHandle(first);
}
