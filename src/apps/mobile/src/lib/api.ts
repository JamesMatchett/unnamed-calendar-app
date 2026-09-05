import { API_BASE } from "@/config";

/**
 * Talking to the API.
 *
 * Small on purpose. There is exactly one endpoint reachable without a token
 * today, so this is the shape rather than the client: a base URL, a timeout,
 * and errors that say which of the several ways a request can fail actually
 * happened. Authentication goes in when there is something to authenticate
 * with; the callers below already pass through a single place for it.
 */

/** How long to wait. Long enough for a cold Lambda, short enough to give up. */
const TIMEOUT_MS = 8000;

export type ApiFailure =
  /** No answer: aeroplane mode, no signal, DNS, a captive portal. */
  | { kind: "offline"; detail: string }
  /** An answer, eventually, but not within TIMEOUT_MS. */
  | { kind: "timeout"; detail: string }
  /** An answer, with a status that is not a success. */
  | { kind: "status"; status: number; detail: string }
  /** A success, whose body was not the JSON it claimed to be. */
  | { kind: "malformed"; detail: string };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

/**
 * These four are distinguished because they mean different things to whoever is
 * looking at the screen. "Offline" is theirs to fix, "timeout" and a 5xx are
 * ours, and a 401 is neither — it means the token is stale. Collapsing them
 * into one "something went wrong" is how a network bug becomes unreportable.
 */
async function request<T>(path: string): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return {
        ok: false,
        error: { kind: "status", status: response.status, detail: response.statusText },
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
