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
        // Injected by the Pre Token Generation trigger, which does not exist
        // yet. Null rather than absent, so a client can tell "no ULID minted"
        // from "field not implemented".
        userId: claim(claims, "custom:uid") ?? null,
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
