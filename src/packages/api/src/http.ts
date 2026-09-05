/**
 * The shape of an API Gateway HTTP API request, as far as this service reads it.
 *
 * Declared here rather than taken from @types/aws-lambda, for the same reason
 * @calder/core carries its own ULID: a types-only dependency is still a
 * dependency, and writing down the four fields actually relied on is a better
 * record of the contract than importing a type covering forty. If a handler
 * starts needing more of the payload, add it here and the addition is visible
 * in review.
 *
 * This is payload format 2.0. The HTTP API is configured for it explicitly in
 * modules/api, because the default differs between integration types and a
 * handler reading `routeKey` from a 1.0 payload gets `undefined` and answers
 * 404 to everything.
 */
export interface HttpEvent {
  /** "2.0". Read only so that a format mismatch fails loudly rather than as a 404. */
  readonly version?: string;
  /** "GET /v1/health". The method and path as *routed*, not as requested. */
  readonly routeKey?: string;
  readonly requestContext?: {
    readonly requestId?: string;
    readonly http?: {
      readonly method?: string;
      readonly path?: string;
    };
    /**
     * Present only when a route has an authoriser attached. API Gateway
     * validates the JWT itself and rejects a bad one before Lambda is invoked,
     * so a handler never sees an unverified token — it sees either verified
     * claims or nothing at all.
     */
    readonly authorizer?: {
      readonly jwt?: {
        readonly claims?: Readonly<Record<string, string | number | boolean>>;
      };
    };
  };
}

export interface HttpResult {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * A JSON response.
 *
 * `no-store` by default, because most of what this API returns is either
 * personal or a liveness claim. A health check answered from a cache is worse
 * than no health check: it reports the last time the service was up rather than
 * whether it is up now.
 *
 * `maxAge` is the exception, for a response that is public, identical for
 * everybody, and changes about once a year. Without it every cold start of
 * every app invokes a Lambda to be told the same four strings — a bill anybody
 * can run up on an unauthenticated route, since it is one that cannot be
 * authenticated even in principle: the app needs it to begin authenticating.
 */
export function json(statusCode: number, body: unknown, maxAge?: number): HttpResult {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control":
        maxAge === undefined ? "no-store" : `public, max-age=${maxAge}`,
    },
    body: JSON.stringify(body),
  };
}
