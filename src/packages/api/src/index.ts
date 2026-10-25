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

import type { CalendarId, EventId, UserId } from "@calder/core";
import { asCognitoSub } from "@calder/core";

import { type HttpEvent, type HttpResult, json, parseBody } from "./http.js";
import { UID_CLAIM } from "./identity.js";
import { accessTo } from "./access.js";
import { changesSince, DEFAULT_LIMIT } from "./changes.js";
import {
  createCalendar,
  deleteCalendar,
  editCalendar,
  listCalendars,
  type CalendarEdit,
  type NewCalendar,
} from "./calendars.js";
import { createEvent, deleteEvent, editEvent, type EventEdit, type NewEvent } from "./events.js";
import { removeMember } from "./members.js";
import { clearRsvp, putRsvp, setTicket } from "./rsvps.js";

// The Stream consumer, also in this bundle. Same argument as the trigger below:
// one artifact means the change log cannot drift from the handlers whose writes
// it is logging.
export { changeLog } from "./changelog.js";

// The Cognito trigger, in the same bundle as the routes. One artifact, two
// functions: Terraform points them at the same zip with different handlers,
// so there is one build, one version, and no way for the two to drift.
export { preTokenGeneration } from "./identity.js";

// Also exported for the tests, which run against this bundle rather than the
// sources because the bundle is what Lambda executes — and bundling has its own
// ways to fail. `useClient` exists only so a test can point the trigger at a
// local engine; nothing in the running system calls it.
export { UID_CLAIM, resolveUserId, useClient } from "./identity.js";
export { accessTo } from "./access.js";
export { createCalendar, deleteCalendar, editCalendar, listCalendars } from "./calendars.js";
export { createEvent, deleteEvent, editEvent } from "./events.js";
export { removeMember } from "./members.js";
export { clearRsvp, putRsvp, setTicket } from "./rsvps.js";
export { changesSince } from "./changes.js";
export { isLoggable, logOne } from "./changelog.js";

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

/**
 * Who is asking, in OUR terms rather than Cognito's.
 *
 * The authoriser has already proved the token; this only turns it into a user
 * id. The `uid` claim is minted by the Pre Token Generation trigger (§3.2), so
 * its absence means a token older than that trigger — recoverable by signing in
 * again, which is why it is a 401 and not a 500.
 */
type Caller =
  | { ok: true; userId: UserId; displayName: string }
  | { ok: false; result: HttpResult };

function caller(event: HttpEvent): Caller {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const uid = claim(claims, UID_CLAIM);
  if (uid === undefined) {
    return {
      ok: false,
      result: json(401, {
        error: "unauthenticated",
        detail: "this token carries no user id; sign in again",
      }),
    };
  }
  return {
    ok: true,
    userId: uid as UserId,
    // Denormalised onto the membership so departed members still resolve to a
    // name (§8.4). Empty rather than absent when the provider never sent one,
    // because the column is not nullable and "" is visibly a gap.
    displayName: claim(claims, "name") ?? "",
  };
}

/**
 * The error body for a handler's refusal.
 *
 * One spelling per status, so the client can switch on `error` without having
 * to know which handler it was talking to. `detail` is the handler's sentence,
 * written for the person reading a bug report rather than for the code.
 */
const ERROR_NAMES: Record<number, string> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  410: "gone",
};

function refused(status: number, detail: string): HttpResult {
  return json(status, { error: ERROR_NAMES[status] ?? "error", detail });
}

/**
 * The two ids every event route carries, or the 400 for a path without them.
 *
 * Checked once here rather than in each arm, because the check is the same
 * eight lines every time and the arms are where the differences belong.
 */
function eventPath(
  event: HttpEvent,
): { ok: true; calendarId: CalendarId; eventId: EventId } | { ok: false; result: HttpResult } {
  const calendarId = event.pathParameters?.["calendarId"];
  const eventId = event.pathParameters?.["eventId"];
  if (calendarId === undefined || calendarId === "" || eventId === undefined || eventId === "") {
    return { ok: false, result: refused(400, "the path needs a calendar id and an event id") };
  }
  return { ok: true, calendarId: calendarId as CalendarId, eventId: eventId as EventId };
}

export async function route(
  event: HttpEvent,
  now: number = Date.now(),
): Promise<HttpResult> {
  const iso = new Date(now).toISOString();

  switch (event.routeKey) {
    case "GET /v1/health":
      return json(200, {
        status: "ok",
        environment: env("CALDER_ENVIRONMENT"),
        commit: env("CALDER_COMMIT"),
        time: new Date(now).toISOString(),
      });

    case "GET /v1/config":
      // What the app needs to start a sign-in, served rather than compiled in.
      //
      // The client id is generated by Cognito, so unlike the API's hostname it
      // cannot be held in step with Terraform by any check: it would be a copy
      // of a value that lives elsewhere, in a build that takes a review cycle
      // to replace. Serving it means there is one source of truth and a stale
      // build fixes itself.
      //
      // Public, and safe to be: none of this is secret. A Cognito client id is
      // in every redirect URL the browser sees, and the point of PKCE is that
      // knowing it gains an attacker nothing.
      //
      // `providers` is the list actually configured, so the sign-in screen
      // offers Apple alone until Google exists rather than offering a button
      // that fails.
      return json(
        200,
        {
          userPoolId: env("CALDER_USER_POOL_ID"),
          clientId: env("CALDER_CLIENT_ID"),
          authDomain: env("CALDER_AUTH_DOMAIN"),
          providers: (process.env["CALDER_PROVIDERS"] ?? "")
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
        },
        // Five minutes. Long enough that a launch spike costs one invocation
        // rather than thousands, short enough that adding Google is visible in
        // the app without waiting for anything to expire.
        300,
      );

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
        // From the provider, via Cognito's attribute mapping, and null far more
        // often than it looks. Google sends a name on every sign-in; Apple
        // sends one on the FIRST authorisation and never again, and only if the
        // person agreed to share it (§3.2). Whatever arrives is stored on the
        // pool, so a later token carries it even though Apple has stopped
        // sending it — but if it was missed once, it is missed for good.
        name: claim(claims, "name") ?? null,
        // With Apple's Hide My Email this is a per-app relay address, which is
        // why nothing in the table is ever keyed on it (§3.2, §7.2).
        email: claim(claims, "email") ?? null,
        // Minted and injected by the Pre Token Generation trigger. Null only
        // if a token predates the trigger, which is worth being able to see
        // rather than crashing on.
        userId: claim(claims, UID_CLAIM) ?? null,
        tokenUse: claim(claims, "token_use") ?? null,
      });
    }

    // --- calendars ---------------------------------------------------------
    //
    // Every one of these is behind the JWT authoriser, so `sub` is verified
    // before the function is invoked. What is NOT free is the user id: `sub` is
    // Cognito's, and every key in the table is built on our ULID (§3.2), so a
    // token minted before the Pre Token Generation trigger existed carries no
    // `uid` and cannot be served. That is a 401 rather than a 500 — the answer
    // is "sign in again", and the client can act on it.

    case "GET /v1/calendars": {
      const who = caller(event);
      if (!who.ok) return who.result;
      // Ids alone, on purpose: see listCalendars. The client follows this with
      // one /changes call per calendar, which is where the content comes from.
      const calendarIds = await listCalendars(env("CALDER_TABLE"), who.userId);
      return json(200, { calendarIds });
    }

    case "PUT /v1/calendars/{calendarId}": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const calendarId = event.pathParameters?.["calendarId"];
      if (calendarId === undefined || calendarId === "") {
        return json(400, { error: "bad_request", detail: "no calendar id in the path" });
      }
      const parsed = parseBody(event.body);
      if (!parsed.ok) return json(400, { error: "bad_request", detail: parsed.detail });

      const result = await createCalendar(
        env("CALDER_TABLE"),
        calendarId as Parameters<typeof createCalendar>[1],
        who.userId,
        who.displayName,
        parsed.value as unknown as NewCalendar,
        new Date(now).toISOString(),
      );
      // 200 rather than 201 on a repeat. The client retries this forever by
      // design, so "already done" is success, and a client that has to tell
      // the two apart can read `created`.
      return json(result.created ? 201 : 200, {
        created: result.created,
        calendar: result.calendar,
      });
    }

    case "GET /v1/calendars/{calendarId}": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const calendarId = event.pathParameters?.["calendarId"];
      if (calendarId === undefined) {
        return json(400, { error: "bad_request", detail: "no calendar id in the path" });
      }
      const access = await accessTo(
        env("CALDER_TABLE"),
        calendarId as Parameters<typeof accessTo>[1],
        who.userId,
      );
      if (!access.ok) return json(404, { error: "not_found" });
      return json(200, { calendar: access.calendar, membership: access.membership });
    }

    case "PATCH /v1/calendars/{calendarId}": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const calendarId = event.pathParameters?.["calendarId"];
      if (calendarId === undefined) {
        return json(400, { error: "bad_request", detail: "no calendar id in the path" });
      }
      const parsed = parseBody(event.body);
      if (!parsed.ok) return json(400, { error: "bad_request", detail: parsed.detail });
      if (typeof parsed.value["version"] !== "number") {
        // Refused rather than defaulted. A missing version is a client that
        // does not know what it is overwriting, and §5.4 exists precisely so
        // that such a write loses rather than wins.
        return json(400, {
          error: "bad_request",
          detail: "version is required, so a stale edit can be refused",
        });
      }

      const result = await editCalendar(
        env("CALDER_TABLE"),
        calendarId as Parameters<typeof editCalendar>[1],
        who.userId,
        parsed.value as unknown as CalendarEdit,
        new Date(now).toISOString(),
      );
      if (result.ok) return json(200, { calendar: result.calendar });
      return json(result.status, {
        error: result.status === 409 ? "conflict" : result.status === 403 ? "forbidden" : "not_found",
        detail: result.detail,
      });
    }

    case "DELETE /v1/calendars/{calendarId}": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const calendarId = event.pathParameters?.["calendarId"];
      if (calendarId === undefined || calendarId === "") {
        return refused(400, "no calendar id in the path");
      }
      const result = await deleteCalendar(
        env("CALDER_TABLE"),
        calendarId as CalendarId,
        who.userId,
        iso,
      );
      if (result.ok) return json(200, { calendar: result.calendar });
      return refused(result.status, result.detail);
    }

    // --- members -----------------------------------------------------------

    case "DELETE /v1/calendars/{calendarId}/members/{userId}": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const calendarId = event.pathParameters?.["calendarId"];
      const userId = event.pathParameters?.["userId"];
      if (calendarId === undefined || calendarId === "" || userId === undefined || userId === "") {
        return refused(400, "the path needs a calendar id and a user id");
      }
      const parsed = parseBody(event.body);
      if (!parsed.ok) return refused(400, parsed.detail);

      const result = await removeMember(
        env("CALDER_TABLE"),
        calendarId as CalendarId,
        who.userId,
        userId as UserId,
        parsed.value["status"],
        iso,
      );
      if (result.ok) return json(200, { membership: result.membership });
      return refused(result.status, result.detail);
    }

    // --- events ------------------------------------------------------------
    //
    // The body shapes are the app's SQLite rows, flattened; events.ts folds
    // them into the nested item. A client-generated ULID in the path makes the
    // create idempotent, so 200 on a repeat is success and `created` says
    // which it was, exactly as for calendars.

    case "PUT /v1/calendars/{calendarId}/events/{eventId}": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const ids = eventPath(event);
      if (!ids.ok) return ids.result;
      const parsed = parseBody(event.body);
      if (!parsed.ok) return refused(400, parsed.detail);

      const result = await createEvent(
        env("CALDER_TABLE"),
        ids.calendarId,
        ids.eventId,
        who.userId,
        parsed.value as unknown as NewEvent,
        iso,
      );
      if (result.ok) return json(result.created ? 201 : 200, { created: result.created, event: result.event });
      return refused(result.status, result.detail);
    }

    case "PATCH /v1/calendars/{calendarId}/events/{eventId}": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const ids = eventPath(event);
      if (!ids.ok) return ids.result;
      const parsed = parseBody(event.body);
      if (!parsed.ok) return refused(400, parsed.detail);
      if (typeof parsed.value["version"] !== "number") {
        // Refused rather than defaulted, as for calendars: a missing version is
        // a client that does not know what it is overwriting (§5.4).
        return refused(400, "version is required, so a stale edit can be refused");
      }

      const result = await editEvent(
        env("CALDER_TABLE"),
        ids.calendarId,
        ids.eventId,
        who.userId,
        parsed.value as unknown as EventEdit,
        iso,
      );
      if (result.ok) return json(200, { event: result.event });
      return refused(result.status, result.detail);
    }

    case "DELETE /v1/calendars/{calendarId}/events/{eventId}": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const ids = eventPath(event);
      if (!ids.ok) return ids.result;

      const result = await deleteEvent(env("CALDER_TABLE"), ids.calendarId, ids.eventId, who.userId);
      if (result.ok) return json(200, { deleted: true });
      return refused(result.status, result.detail);
    }

    // --- rsvps -------------------------------------------------------------
    //
    // Always the caller's own answer. The user id comes from the token and
    // nowhere else, so there is no route for answering on somebody's behalf.

    case "PUT /v1/calendars/{calendarId}/events/{eventId}/rsvp": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const ids = eventPath(event);
      if (!ids.ok) return ids.result;
      const parsed = parseBody(event.body);
      if (!parsed.ok) return refused(400, parsed.detail);

      const result = await putRsvp(
        env("CALDER_TABLE"),
        ids.calendarId,
        ids.eventId,
        who.userId,
        parsed.value,
        iso,
      );
      if (result.ok) return json(200, { rsvp: result.rsvp });
      return refused(result.status, result.detail);
    }

    case "DELETE /v1/calendars/{calendarId}/events/{eventId}/rsvp": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const ids = eventPath(event);
      if (!ids.ok) return ids.result;
      const parsed = parseBody(event.body);
      if (!parsed.ok) return refused(400, parsed.detail);

      const result = await clearRsvp(
        env("CALDER_TABLE"),
        ids.calendarId,
        ids.eventId,
        who.userId,
        parsed.value,
      );
      if (result.ok) return json(200, { cleared: true });
      return refused(result.status, result.detail);
    }

    case "PUT /v1/calendars/{calendarId}/events/{eventId}/rsvp/ticket": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const ids = eventPath(event);
      if (!ids.ok) return ids.result;
      const parsed = parseBody(event.body);
      if (!parsed.ok) return refused(400, parsed.detail);

      const result = await setTicket(
        env("CALDER_TABLE"),
        ids.calendarId,
        ids.eventId,
        who.userId,
        parsed.value,
        iso,
      );
      if (result.ok) return json(200, { rsvp: result.rsvp });
      return refused(result.status, result.detail);
    }

    case "GET /v1/calendars/{calendarId}/changes": {
      const who = caller(event);
      if (!who.ok) return who.result;
      const calendarId = event.pathParameters?.["calendarId"];
      if (calendarId === undefined) {
        return json(400, { error: "bad_request", detail: "no calendar id in the path" });
      }
      const since = Number(event.queryStringParameters?.["since"] ?? "0");
      const limit = Number(event.queryStringParameters?.["limit"] ?? String(DEFAULT_LIMIT));
      if (!Number.isFinite(since) || since < 0) {
        return json(400, { error: "bad_request", detail: "since must be a non-negative number" });
      }

      const result = await changesSince(
        env("CALDER_TABLE"),
        calendarId as Parameters<typeof changesSince>[1],
        who.userId,
        since,
        Number.isFinite(limit) ? limit : DEFAULT_LIMIT,
      );
      if (result.ok) return json(200, result.body);
      if (result.status === 410) return json(410, result.body);
      return json(404, { error: "not_found" });
    }

    default:
      // Includes the case where routeKey is undefined, which means the payload
      // format is not 2.0.
      return json(404, { error: "not_found", routeKey: event.routeKey ?? null });
  }
}

export const handler = async (event: HttpEvent): Promise<HttpResult> => route(event);
