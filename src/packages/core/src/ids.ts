/**
 * Identifiers are ULIDs, never auto-increment counters.
 *
 * DynamoDB has no sequences, and emulating one means an atomic counter on a
 * single item — a hot key, an extra write per creation, and a value that cannot
 * be generated offline. The offline-first client in Architecture.md §5.3 depends
 * on being able to mint an id with no network, which is also what makes writes
 * idempotent by primary key.
 *
 * ULIDs additionally sort lexicographically by creation time, which several key
 * shapes rely on.
 */

/**
 * ULID generation, implemented here rather than taken from the `ulid` package.
 *
 * That package refuses to run without a cryptographic PRNG, and Hermes ships no
 * WebCrypto, so it throws `PRNG_DETECT` on device. Polyfilling crypto to satisfy
 * it would be a dependency and a native module for something this small, and it
 * would leave core claiming to be dependency-free while not being so.
 *
 * Crockford base32: 10 characters of millisecond timestamp followed by 16 of
 * randomness. Lexicographic order therefore matches creation order, which
 * several key shapes rely on.
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O or U
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

/**
 * Uses the platform's cryptographic source when there is one, and falls back to
 * `Math.random` when there is not.
 *
 * The fallback is acceptable because these are identifiers, not secrets: they
 * are unguessable enough to avoid collisions and never used to authorise
 * anything. Invite tokens are a different matter and are minted server-side with
 * real entropy (§7.1).
 */
function randomByte(): number {
  // Structurally typed: core's lib is ES2022 with no DOM, so the `Crypto` type
  // does not exist here, and the runtime may not provide it either.
  const webCrypto = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
    }
  ).crypto;

  if (webCrypto?.getRandomValues) {
    const buffer = new Uint8Array(1);
    webCrypto.getRandomValues(buffer);
    return buffer[0] ?? 0;
  }
  return Math.floor(Math.random() * 256);
}

function encodeTime(now: number): string {
  let out = "";
  let remaining = now;
  for (let i = TIME_LENGTH - 1; i >= 0; i -= 1) {
    const mod = remaining % 32;
    out = (ENCODING[mod] ?? "0") + out;
    remaining = (remaining - mod) / 32;
  }
  return out;
}

function encodeRandom(): string {
  let out = "";
  for (let i = 0; i < RANDOM_LENGTH; i += 1) {
    out += ENCODING[randomByte() % 32] ?? "0";
  }
  return out;
}

/** A new ULID: sortable by creation time, generatable offline. */
export const ulid = (now: number = Date.now()): string =>
  encodeTime(now) + encodeRandom();

declare const brand: unique symbol;

/** Nominal typing, so a CalendarId cannot be passed where an EventId is meant. */
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, "UserId">;
export type CalendarId = Brand<string, "CalendarId">;
export type EventId = Brand<string, "EventId">;
export type SuggestionId = Brand<string, "SuggestionId">;
export type NotificationId = Brand<string, "NotificationId">;
export type FestivalId = Brand<string, "FestivalId">;
export type FestivalSessionId = Brand<string, "FestivalSessionId">;
export type ArtistId = Brand<string, "ArtistId">;

/**
 * The Cognito `sub`. Deliberately NOT the user id — see §3.2. It appears only in
 * the identity mapping item, so that rebuilding the user pool or changing IdP
 * does not invalidate every key in the table.
 */
export type CognitoSub = Brand<string, "CognitoSub">;

export const newUserId = (): UserId => ulid() as UserId;
export const newCalendarId = (): CalendarId => ulid() as CalendarId;
export const newEventId = (): EventId => ulid() as EventId;
export const newSuggestionId = (): SuggestionId => ulid() as SuggestionId;
export const newNotificationId = (): NotificationId => ulid() as NotificationId;
export const newArtistId = (): ArtistId => ulid() as ArtistId;

/** Escape hatch for ids arriving from the wire or from SQLite. */
export const asUserId = (s: string): UserId => s as UserId;
export const asCalendarId = (s: string): CalendarId => s as CalendarId;
export const asEventId = (s: string): EventId => s as EventId;
export const asArtistId = (s: string): ArtistId => s as ArtistId;
