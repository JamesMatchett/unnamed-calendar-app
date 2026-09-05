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
 * Lower case ASCII letters and digits, with dots, underscores and hyphens
 * between them. Nothing else survives, and nothing else needs to: a handle goes
 * into a URL path, onto a QR code, and back out of somebody else's camera.
 *
 * Folded before it is filtered, which is the part that is easy to leave out.
 * "café" arrives as one character or as two depending on the keyboard that
 * typed it, and a filter alone answers "caf" to one and "cafe" to the other —
 * the same handle, visibly identical, resolving to two different people.
 * NFKD splits the accent off so both become "cafe", and folds the compatibility
 * forms while it is there, so full-width "ｊａｍｅｓ" is james rather than
 * nothing at all.
 *
 * What it will NOT do is transliterate. Cyrillic, Greek and Han have no ASCII
 * decomposition and are dropped, so "јаmes" written with Cyrillic ј and а
 * becomes "mes". That is deliberate: guessing at a Latin spelling for another
 * script is how a handle silently becomes somebody else's, and the field shows
 * what will be stored, so it is visible rather than surprising.
 *
 * Runs of punctuation collapse and the edges are trimmed. Without that, "..."
 * and "___" were handles, and "sam.99" and "sam..99" were two different people
 * distinguishable only by counting dots.
 *
 * Idempotent, which matters more than it looks: this runs on input, again when
 * a link is built, and again when one is opened, so normalising a normalised
 * handle has to be the same handle or a round trip changes who you are. The
 * trailing trim is repeated after the cap for that reason — the cap can land
 * mid-punctuation.
 */
export function normaliseHandle(raw: string): string {
  const cleaned = raw
    // Decompose accents and fold the compatibility forms. Before the filter,
    // never after: afterwards there is nothing left to fold.
    .normalize("NFKD")
    // The marks NFKD just separated out, plus any that arrived on their own.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // Everything else goes, which covers the sigils people type out of habit,
    // zero-width characters, direction overrides, emoji and every other script.
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/[._-]{2,}/g, (run) => run[0] ?? "")
    .replace(/^[._-]+|[._-]+$/g, "");

  return cleaned.slice(0, HANDLE_MAX).replace(/[._-]+$/, "");
}

/** A first guess at a handle from a name: "Maya Okonkwo" -> "maya". */
export function suggestHandle(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  return normaliseHandle(first);
}
