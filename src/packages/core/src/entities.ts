/**
 * Item shapes for the single table. Architecture.md §4.3 is the specification.
 *
 * Every item carries `entityType`: the Stream consumer and the client's SQLite
 * writer both need to know what they are looking at without parsing keys.
 */

import type {
  ArtistId,
  CalendarId,
  EventId,
  FestivalId,
  FestivalSessionId,
  NotificationId,
  SuggestionId,
  UserId,
} from "./ids.js";
import type {
  EpochSeconds,
  EventTime,
  Instant,
  IsoDate,
  RRuleString,
  TimeZoneId,
} from "./time.js";

export interface BaseItem {
  readonly PK: string;
  readonly SK: string;
  readonly entityType: EntityType;
  readonly GSI1PK?: string;
  readonly GSI1SK?: string;
  /** Epoch SECONDS. One TTL attribute serves the whole table — see time.ts. */
  readonly expiresAt?: EpochSeconds;
}

export type EntityType =
  | "user"
  | "identity"
  | "calendar"
  | "membership"
  | "event"
  | "rsvp"
  | "suggestion"
  | "availability"
  | "change"
  | "invite"
  | "pendingInvite"
  | "joinRequest"
  | "notification"
  | "festival"
  | "festivalSession"
  | "artist"
  | "artistAlias";

// --- identity --------------------------------------------------------------

export interface UserProfileItem extends BaseItem {
  readonly entityType: "user";
  readonly userId: UserId;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly tz: TimeZoneId;
  readonly locale: string;
  /** User-selectable, defaults to 'agenda' (§3.5). Server-side so it follows them. */
  readonly homeTab: "agenda" | "calendars";
  /** Drives the inbox badge (§7.3). */
  readonly lastReadNotifAt?: Instant;
  readonly createdAt: Instant;
}

/** Maps a Cognito sub to our ULID. Several subs may map to one user (§3.2). */
export interface IdentityItem extends BaseItem {
  readonly entityType: "identity";
  readonly userId: UserId;
  readonly provider: "apple" | "google";
  readonly linkedAt: Instant;
}

// --- calendars and membership ---------------------------------------------

export type CalendarMode = "bounded" | "continuous";

/**
 * How people get to this calendar's thing. Purely presentational — it changes
 * the icon on arrivals and departures — but it lives on the calendar because a
 * road trip and a flight abroad are different enough that a plane on every
 * arrival reads as wrong for one of them.
 */
export type TravelMode = "plane" | "train" | "car" | "boat" | "walk";

export const TRAVEL_MODES: readonly TravelMode[] = [
  "plane",
  "train",
  "car",
  "boat",
  "walk",
];

export interface CalendarItem extends BaseItem {
  readonly entityType: "calendar";
  readonly calendarId: CalendarId;
  readonly name: string;
  readonly description?: string;
  readonly coverImageUrl?: string;
  readonly mode: CalendarMode;
  readonly startDate?: IsoDate;
  readonly endDate?: IsoDate;
  /** Events default to this, not the phone's zone (§3.5). */
  readonly defaultTz: TimeZoneId;
  readonly collectAvailability: boolean;
  /** Only meaningful when `collectAvailability` is set. Defaults to plane. */
  readonly travelMode: TravelMode;
  /** Default true. Every joiner is approved, with no exceptions (§7.1). */
  readonly requireApproval: boolean;
  readonly allowMemberInvites: boolean;
  /**
   * Default true — the Brief's premise is that friends submit events. Turning it
   * off makes the calendar curated rather than collaborative, which suits a
   * promoter or a tightly-run trip.
   */
  readonly allowMemberEvents: boolean;
  readonly sourceFestId?: FestivalId;
  /** Rotatable secret in the read-only ICS feed URL (§5.7). */
  readonly icsToken: string;
  /** 30-day restorable soft delete (§8.5). */
  readonly status: "active" | "deleted";
  readonly deletedAt?: Instant;
  readonly createdBy: UserId;
  readonly createdAt: Instant;
}

export type MemberRole = "owner" | "member";

/**
 * Membership status is NOT a proxy for existence. Items are soft-deleted so that
 * departed members still resolve to a name on events they created — which means
 * the authorisation check must test `status === 'active'`, never mere presence.
 * Use `isActiveMember` in membership.ts rather than writing the test by hand.
 */
export type MemberStatus = "active" | "left" | "removed";

export interface MembershipItem extends BaseItem {
  readonly entityType: "membership";
  readonly calendarId: CalendarId;
  readonly userId: UserId;
  readonly role: MemberRole;
  readonly status: MemberStatus;
  /** Denormalised so departed and deleted users still render (§8.4, §8.5). */
  readonly displayName: string;
  readonly joinedAt: Instant;
  readonly leftAt?: Instant;
  readonly removedAt?: Instant;
  /**
   * Persists across a rejoin. Removal is not a ban, but a previously removed
   * user is forced through approval regardless of `requireApproval` (§8.4).
   */
  readonly wasRemoved: boolean;
  readonly invitedBy?: UserId;
  readonly viaInviteToken?: string;
  /** Server-side sync watermark, so unread badges agree across devices. */
  readonly lastSeenSeq: number;
  readonly notifyMuted: boolean;
}

// --- events ----------------------------------------------------------------

export interface EventLocation {
  readonly name: string;
  readonly address?: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly placeId?: string;
}

export interface EventItem extends BaseItem {
  readonly entityType: "event";
  readonly calendarId: CalendarId;
  readonly eventId: EventId;
  readonly title: string;
  readonly description?: string;
  readonly time: EventTime;
  readonly location?: EventLocation;
  readonly ticketsRequired: boolean;
  readonly ticketUrl?: string;
  /** Set by the author. False still permits owners to edit directly (§8.1). */
  readonly allowSuggestions: boolean;
  /** Cancel precedes delete; delete is unavailable while active (§8.2). */
  readonly status: "active" | "cancelled";
  readonly cancelledAt?: Instant;
  readonly cancelledBy?: UserId;
  /** The current author — reassignable by claiming an orphan (§8.4). */
  readonly createdBy: UserId;
  /** Set only on a claim, so authorship is never silently rewritten. */
  readonly originalCreatedBy?: UserId;
  readonly createdAt: Instant;
  readonly lastUpdatedBy: UserId;
  readonly lastUpdatedAt: Instant;
  /** Drives the ConditionExpression on every direct edit (§5.4). */
  readonly version: number;

  /** Series master only. Expanded on the client, never in the table (§5.5). */
  readonly rrule?: RRuleString;
  /** Occurrence overrides only: which series, and which occurrence. */
  readonly seriesId?: EventId;
  readonly recurrenceId?: Instant;

  /** Provenance when copied from a festival lineup (§6.1). */
  readonly festSessionId?: FestivalSessionId;
  readonly festSessionVersion?: number;
}

// --- attendance ------------------------------------------------------------

export type RsvpStatus = "going" | "maybe" | "not_going";

/**
 * There is no 'no_response' value. Absence of the item IS the state, which is
 * what makes "4 haven't replied" possible and the nudge action meaningful.
 */
/**
 * The parts of an answer that resolution actually depends on. Separated from the
 * stored item so the rule can be applied to a row read out of the client's
 * SQLite mirror without first reconstructing DynamoDB keys.
 */
export interface RsvpAnswer {
  /** A real occurrence instant, or SERIES_DEFAULT for "all upcoming". */
  readonly occurrence: string;
  readonly status: RsvpStatus;
  readonly hasTicket?: boolean;
  /**
   * Series defaults only. Stops "I'm going to all of these" from retroactively
   * answering for occurrences that have already happened (§5.5).
   */
  readonly effectiveFrom?: Instant;
}

export interface RsvpItem extends BaseItem, RsvpAnswer {
  readonly entityType: "rsvp";
  readonly calendarId: CalendarId;
  readonly eventId: EventId;
  readonly userId: UserId;
  readonly respondedAt: Instant;
}

export interface AvailabilityItem extends BaseItem {
  readonly entityType: "availability";
  readonly calendarId: CalendarId;
  readonly userId: UserId;
  readonly arrivesAt?: Instant;
  readonly departsAt?: Instant;
  readonly updatedAt: Instant;
}

// --- suggestions -----------------------------------------------------------

/** The subset of event fields a non-author may propose changing. */
export type SuggestableField =
  | "title"
  | "description"
  | "time"
  | "location"
  | "ticketsRequired"
  | "ticketUrl";

export type FieldDiff<K extends SuggestableField = SuggestableField> = {
  readonly field: K;
  readonly oldValue: EventItem[K] | null;
  readonly newValue: EventItem[K] | null;
};

/**
 * Diffs, not replacement events. Partial acceptance becomes possible, the author
 * sees exactly what moved, and two people editing different fields do not
 * conflict at all (§8.1).
 */
export interface SuggestionItem extends BaseItem {
  readonly entityType: "suggestion";
  readonly calendarId: CalendarId;
  readonly eventId: EventId;
  readonly suggestionId: SuggestionId;
  readonly suggestedBy: UserId;
  readonly suggestedAt: Instant;
  /** If this no longer matches the event, the suggestion is `outdated`. */
  readonly baseVersion: number;
  readonly changes: readonly FieldDiff[];
  readonly status: "pending" | "accepted" | "rejected" | "outdated";
  /** Recurring events: a suggestion applies to one occurrence only (§5.5). */
  readonly occurrence?: string;
}

// --- sync, invites, inbox --------------------------------------------------

export type ChangeOp = "put" | "delete";

/**
 * Written by the Stream consumer, which assigns `seq`. Letting the stream number
 * changes gives gap-free ordering per calendar for free and keeps the
 * user-facing write to a single round trip (§5.1).
 */
export interface ChangeLogItem extends BaseItem {
  readonly entityType: "change";
  readonly calendarId: CalendarId;
  readonly seq: number;
  readonly op: ChangeOp;
  readonly targetType: EntityType;
  readonly targetId: string;
  readonly actorId: UserId;
  readonly serverTs: Instant;
  readonly payload?: unknown;
}

export interface InviteItem extends BaseItem {
  readonly entityType: "invite";
  readonly calendarId: CalendarId;
  readonly createdBy: UserId;
  readonly createdAt: Instant;
  readonly maxUses?: number;
  readonly useCount: number;
  readonly revokedAt?: Instant;
}

export interface PendingInviteItem extends BaseItem {
  readonly entityType: "pendingInvite";
  readonly calendarId: CalendarId;
  readonly invitedBy: UserId;
  readonly invitedAt: Instant;
  /** Present only on the known-user form; the email form is keyed by hash. */
  readonly userId?: UserId;
}

export interface JoinRequestItem extends BaseItem {
  readonly entityType: "joinRequest";
  readonly calendarId: CalendarId;
  readonly userId: UserId;
  readonly displayName: string;
  readonly requestedAt: Instant;
  readonly viaInviteToken?: string;
  /** Shown in the approval prompt when this user was removed before (§8.4). */
  readonly previouslyRemoved: boolean;
}

export type NotificationKind =
  | "invite_pending"
  | "join_request"
  | "joined_via_link"
  | "removed_from_calendar"
  | "ownership_granted"
  | "ownership_revoked"
  | "calendar_deleted"
  | "event_added"
  | "event_cancelled"
  | "event_deleted_by_owner"
  | "suggestion_received"
  | "suggestion_accepted"
  | "suggestion_rejected"
  | "rsvp_nudge";

export interface NotificationItem extends BaseItem {
  readonly entityType: "notification";
  readonly notificationId: NotificationId;
  readonly userId: UserId;
  readonly kind: NotificationKind;
  readonly createdAt: Instant;
  readonly calendarId?: CalendarId;
  readonly eventId?: EventId;
  readonly actorId?: UserId;
  readonly actorName?: string;
}

// --- catalogue -------------------------------------------------------------

export interface FestivalItem extends BaseItem {
  readonly entityType: "festival";
  readonly festivalId: FestivalId;
  readonly name: string;
  readonly slug: string;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly tz: TimeZoneId;
  readonly bundleVersion: number;
  /** Nullable and unused until promoters ship — a claim becomes a field update. */
  readonly ownerPromoterId?: string;
  readonly sourceId: string;
  readonly sourceUrl?: string;
  readonly ingestedAt: Instant;
  readonly redistributable: boolean;
  readonly attributionRequired: boolean;
}

export interface FestivalSessionItem extends BaseItem {
  readonly entityType: "festivalSession";
  readonly festivalId: FestivalId;
  readonly sessionId: FestivalSessionId;
  readonly title: string;
  readonly stage?: string;
  readonly startUtc: Instant;
  readonly endUtc?: Instant;
  readonly artistIds: readonly ArtistId[];
  /** Bumped when the promoter moves a set, so clients can prompt (§6.1). */
  readonly version: number;
}

export interface ArtistItem extends BaseItem {
  readonly entityType: "artist";
  readonly artistId: ArtistId;
  readonly displayName: string;
  readonly canonicalSlug: string;
  /** Set when merged away; references resolve through the redirect (§6.6). */
  readonly mergedInto?: ArtistId;
  readonly createdAt: Instant;
}

export interface ArtistAliasItem extends BaseItem {
  readonly entityType: "artistAlias";
  readonly slug: string;
  readonly artistId: ArtistId;
}

export type AnyItem =
  | UserProfileItem
  | IdentityItem
  | CalendarItem
  | MembershipItem
  | EventItem
  | RsvpItem
  | AvailabilityItem
  | SuggestionItem
  | ChangeLogItem
  | InviteItem
  | PendingInviteItem
  | JoinRequestItem
  | NotificationItem
  | FestivalItem
  | FestivalSessionItem
  | ArtistItem
  | ArtistAliasItem;
