import * as SecureStore from "expo-secure-store";

/**
 * The tokens, in the Keychain.
 *
 * Not in SQLite beside the calendars. A refresh token lasts 180 days (§3.2) and
 * is the one value in this app worth stealing: with it, somebody is you until it
 * expires. The Keychain is not copied by an unencrypted backup and is not
 * readable by another app; the database is a file.
 *
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY rather than the default: the tokens should not
 * travel to a new phone in a backup. Signing in again is a few seconds, and a
 * restored session is one nobody chose to create.
 */

const KEY = "calder.session";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface Session {
  /** The token the API validates. Carries the `uid` claim (§3.2, decision 40). */
  readonly idToken: string;
  /** Absent when a provider declines to issue one. */
  readonly refreshToken: string | null;
  /** Epoch milliseconds. Cognito gives seconds-from-now; this is absolute. */
  readonly expiresAt: number;
  /** Which provider this came from, for the sake of saying so on screen. */
  readonly provider: string;
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session), OPTIONS);
}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    // Written by an older build in a shape this one cannot read. Dropping it is
    // right: a session nobody can parse is a sign-in nobody can end.
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY, OPTIONS);
}

/**
 * A minute of slack, because the token is checked here and used there.
 *
 * Without it a token that passes this check can still be rejected by API
 * Gateway a moment later, and the failure looks like a bug rather than an
 * expiry.
 */
const SKEW_MS = 60_000;

export const isFresh = (session: Session, now = Date.now()): boolean =>
  session.expiresAt - SKEW_MS > now;
