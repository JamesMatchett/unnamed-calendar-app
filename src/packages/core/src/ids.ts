import { ulid } from "ulid";

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
