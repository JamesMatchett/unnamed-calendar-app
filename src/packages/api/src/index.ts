/**
 * The Cal&der API, such as it is: two routes that exist to prove the path from
 * a request to a handler and back.
 *
 * Architecture.md §3.3 calls for one function per route group rather than one
 * per route or one monolith. This is the first of those groups and it is
 * deliberately the smallest thing that can fail informatively:
 *
 *   GET /v1/health  public, so a failure means the API, the integration or the
 *                   function, and nothing to do with identity
 *   GET /v1/me      behind the pool's JWT authoriser, so a 401 here alongside a
 *                   200 on health isolates the authoriser exactly
 *
 * A single public route can pass while the authorised path is broken, and one
 * authorised route failing cannot tell you which of three things failed. Two
 * routes with different requirements can.
 */

import { asCognitoSub } from "@calder/core";

import { type HttpEvent, type HttpResult, json } from "./http.js";
import { UID_CLAIM } from "./identity.js";

// The Cognito trigger, in the same bundle as the routes. One artifact, two
// functions: Terraform points them at the same zip with different handlers,
// so there is one build, one version, and no way for the two to drift.
export { preTokenGeneration } from "./identity.js";

// Also exported for the tests, which run against this bundle rather than the
// sources because the bundle is what Lambda executes — and bundling has its own
// ways to fail. `useClient` exists only so a test can point the trigger at a
// local engine; nothing in the running system calls it.
export { UID_CLAIM, resolveUserId, useClient } from "./identity.js";

/**
 * Read per request rather than captured at module scope, so that a test can set
 * them and so that a value is never baked into a warm container from whatever
 * the environment happened to be at cold start. The cost is a property lookup.
 */
function env(name: string): string {
  return process.env[name] ?? "unknown";
}

/**
 * A claim's value as a string, or undefined.
 *
 * Claims arrive typed as string | number | boolean because a JWT's payload is
 * JSON, and `exp` really is a number. Everything read here is an identifier, so
 * anything non-string is a surprise worth dropping rather than coercing.
 */
function claim(
  claims: Readonly<Record<string, string | number | boolean>> | undefined,
  name: string,
): string | undefined {
  const value = claims?.[name];
  return typeof value === "string" ? value : undefined;
}

export function route(event: HttpEvent, now: number = Date.now()): HttpResult {
  switch (event.routeKey) {
    case "GET /v1/health":
      return json(200, {
        status: "ok",
        environment: env("CALDER_ENVIRONMENT"),
        commit: env("CALDER_COMMIT"),
        time: new Date(now).toISOString(),
      });

    case "GET /v1/me": {
      const claims = event.requestContext?.authorizer?.jwt?.claims;
      const sub = claim(claims, "sub");

      if (sub === undefined) {
        // Unreachable while the authoriser is attached: API Gateway answers 401
        // itself and never invokes the function. Seeing this body in a response
        // therefore means the authoriser has come off the route, which is a
        // configuration failure rather than a caller's mistake, and is worth
        // saying out loud rather than returning a bare 401 indistinguishable
        // from a missing token.
        return json(401, {
          error: "unauthenticated",
          detail: "no verified claims reached the handler; the route's authoriser may be detached",
        });
      }

      return json(200, {
        // Cognito's subject, which is deliberately NOT the user id (§3.2).
        // Branding it here rather than passing a bare string is the point of
        // the type: the moment a handler writes USER#{...} keys, putting a sub
        // where a ULID belongs stops compiling.
        sub: asCognitoSub(sub),
        // Minted and injected by the Pre Token Generation trigger. Null only
        // if a token predates the trigger, which is worth being able to see
        // rather than crashing on.
        userId: claim(claims, UID_CLAIM) ?? null,
        tokenUse: claim(claims, "token_use") ?? null,
      });
    }

    default:
      // Includes the case where routeKey is undefined, which means the payload
      // format is not 2.0.
      return json(404, { error: "not_found", routeKey: event.routeKey ?? null });
  }
}

export const handler = async (event: HttpEvent): Promise<HttpResult> => route(event);
