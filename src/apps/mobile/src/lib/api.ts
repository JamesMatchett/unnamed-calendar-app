import { API_BASE } from "@/config";

/**
 * Talking to the API.
 *
 * Small on purpose: a base URL, a timeout, and errors that say which of the
 * several ways a request can fail actually happened. `call` is the whole
 * client; the named functions below are the handful of reads the screens make
 * directly, and the sync layer drives `call` with whatever the mutation queue
 * holds.
 */

/** How long to wait. Long enough for a cold Lambda, short enough to give up. */
const TIMEOUT_MS = 8000;

export type ApiFailure =
  /** No answer: aeroplane mode, no signal, DNS, a captive portal. */
  | { kind: "offline"; detail: string }
  /** An answer, eventually, but not within TIMEOUT_MS. */
  | { kind: "timeout"; detail: string }
  /** An answer, with a status that is not a success. `body` is its JSON, when it had any. */
  | { kind: "status"; status: number; detail: string; body?: unknown }
  /** A success, whose body was not the JSON it claimed to be. */
  | { kind: "malformed"; detail: string };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

/**
 * These four are distinguished because they mean different things to whoever is
 * looking at the screen. "Offline" is theirs to fix, "timeout" and a 5xx are
 * ours, and a 401 is neither — it means the token is stale. Collapsing them
 * into one "something went wrong" is how a network bug becomes unreportable.
 */
export type Method = "GET" | "PUT" | "POST" | "PATCH" | "DELETE";

export interface Call {
  readonly method: Method;
  readonly path: string;
  /** JSON-encoded when present. A DELETE may carry one; the sync queue does. */
  readonly body?: unknown;
  readonly token?: string | undefined;
}

export async function call<T>(request: Call): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${request.path}`, {
      method: request.method,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
        // The ID token, not the access token: it is the one carrying the `uid`
        // claim, because putting a custom claim in an access token would have
        // required Cognito's Essentials plan (decision 40).
        ...(request.token === undefined ? {} : { authorization: `Bearer ${request.token}` }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });

    if (!response.ok) {
      // The body's `detail` when there is one, because "409 Conflict" says
      // less than "event has moved on from version 3".
      let detail = response.statusText;
      let body: unknown;
      try {
        body = await response.json();
        const parsed = body as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        // Not JSON, or empty. The status text will have to do.
      }
      return {
        ok: false,
        error: { kind: "status", status: response.status, detail, ...(body === undefined ? {} : { body }) },
      };
    }

    try {
      return { ok: true, value: (await response.json()) as T };
    } catch (cause) {
      return { ok: false, error: { kind: "malformed", detail: String(cause) } };
    }
  } catch (cause) {
    // fetch rejects with an AbortError for the timeout and a TypeError for a
    // transport failure. React Native's message for the latter is the useless
    // "Network request failed", which is exactly why the kind matters more
    // than the text.
    const aborted = cause instanceof Error && cause.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? { kind: "timeout", detail: `no answer in ${TIMEOUT_MS / 1000}s` }
        : { kind: "offline", detail: String(cause) },
    };
  } finally {
    clearTimeout(timer);
  }
}

const request = <T>(path: string, token?: string): Promise<ApiResult<T>> =>
  call<T>({ method: "GET", path, token });

export interface Health {
  status: string;
  environment: string;
  commit: string;
  time: string;
}

/**
 * Ask the API what it is.
 *
 * The one route with no authoriser, which makes it the only thing a build can
 * check before sign-in exists — and the useful thing it returns is not "ok" but
 * WHICH environment answered. A build pointed at the wrong one gets a perfectly
 * healthy 200 from somewhere it should not be talking to, and that is the
 * failure this is really for.
 */
export const health = (): Promise<ApiResult<Health>> => request<Health>("/v1/health");

export interface ApiConfig {
  userPoolId: string;
  clientId: string;
  authDomain: string;
  /** Cognito's names: "SignInWithApple", "Google". Empty until one is set up. */
  providers: string[];
}

/**
 * What this environment needs to sign somebody in.
 *
 * Fetched rather than compiled in. The Cognito client id is generated rather
 * than declared, so nothing can hold a copy of it in step with the truth, and a
 * stale one in a build already on somebody's phone fails sign-in with an error
 * naming nothing useful. None of it is secret: the client id is in every
 * redirect URL the browser sees, and PKCE is what makes knowing it worthless.
 */
export const apiConfig = (): Promise<ApiResult<ApiConfig>> =>
  request<ApiConfig>("/v1/config");

export interface Me {
  /** Cognito's subject. Deliberately not the user id (§3.2). */
  sub: string;
  /**
   * What the provider called them, or null. Null is the ordinary case, not the
   * exceptional one: Google sends a name every time, Apple sends one on the
   * first authorisation only and only with consent.
   */
  name: string | null;
  /** A per-app relay address when Apple's Hide My Email is used. Never a key. */
  email: string | null;
  /** Our own ULID, minted on first sign-in. Null only for a token that predates it. */
  userId: string | null;
  tokenUse: string | null;
}

export const me = (idToken: string): Promise<ApiResult<Me>> =>
  request<Me>("/v1/me", idToken);
