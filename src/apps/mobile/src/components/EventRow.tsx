import { Ionicons } from "@expo/vector-icons";
import type { RsvpStatus } from "@calder/core";
import { Link } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { EventRow as EventRowData, MemberRow, RsvpRow } from "@/db/repo";
import { clearRsvp, resolveForUser, setRsvp, tallyForEvent } from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { formatEventTime } from "@/lib/format";
import { useSyncing } from "@/lib/useSyncing";
import { radius, space, type, useTheme } from "@/theme";

import { AvatarStack } from "./ui";
import { RsvpControl } from "./RsvpControl";

/**
 * One event in a list. Carries its own attendance summary and RSVP control,
 * because opening an event to answer would waste the one property of the data
 * model that makes answering free (§3.5).
 */
export function EventRow({
  event,
  members,
  rsvps,
  subtitle,
  from,
}: {
  event: EventRowData;
  members: readonly MemberRow[];
  rsvps: readonly RsvpRow[];
  subtitle?: string;
  /**
   * Where the tap came from. "calendar" means the calendar was already on
   * screen, so the event detail can drop the link back to it rather than
   * offering a journey the person has just made.
   */
  from?: "calendar";
}) {
  const t = useTheme();

  // Non-recurring events have exactly one occurrence, which the series default
  // covers — the degenerate case of the same rule (§5.5).
  const occurrence = "-";

  const mine = resolveForUser(rsvps, event.event_id, occurrence, CURRENT_USER_ID);
  const tally = tallyForEvent(rsvps, event.event_id, occurrence, members);

  const goingNames = members
    .filter(
      (m) =>
        resolveForUser(rsvps, event.event_id, occurrence, m.user_id).status ===
        "going",
    )
    .map((m) => m.display_name);

  const cancelled = event.status === "cancelled";
  const mineToEdit = event.created_by === CURRENT_USER_ID;
  const pending = event.sync_state === "pending";
  // A calendar of one. Not "is it private": a two-person private calendar still
  // has somebody to answer to.
  const solo = members.length <= 1;
  const syncing = useSyncing();

  return (
    <View
      style={{
        backgroundColor: t.color.surface,
        borderColor: t.color.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        padding: space.lg,
        gap: space.sm,
        // Pending writes are shown but never block interaction (§5.6).
        opacity: pending ? 0.6 : 1,
      }}
    >
      <Link
        href={{
          pathname: "/calendar/[calendarId]/event/[eventId]",
          params: {
            calendarId: event.calendar_id,
            eventId: event.event_id,
            ...(from ? { from } : {}),
          },
        }}
        asChild
      >
        <Pressable accessibilityRole="link">
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  ...type.label,
                  fontSize: 16,
                  color: t.color.text,
                  textDecorationLine: cancelled ? "line-through" : "none",
                }}
              >
                {event.title}
              </Text>
              <Text style={{ ...type.caption, color: t.color.textMuted, marginTop: 2 }}>
                {formatEventTime({
                  startUtc: event.start_utc,
                  endUtc: event.end_utc ?? undefined,
                  tz: event.tz,
                  localWall: event.local_wall,
                  precision: event.precision,
                })}
                {event.location_name ? ` · ${event.location_name}` : ""}
                {subtitle ? ` · ${subtitle}` : ""}
              </Text>
            </View>
            {/* Two different facts, shown differently. A spinner means an
                attempt is happening now; "Pending" means the write is queued
                and nothing is being tried, which is the ordinary state offline.
                Spinning at something nobody is attempting is a lie, and it is
                the kind people learn to ignore. Either way the write is local
                and safe (§5.6). */}
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              {pending ? (
                syncing ? (
                  <ActivityIndicator
                    size="small"
                    color={t.color.textMuted}
                    accessibilityLabel="Syncing"
                    style={{ transform: [{ scale: 0.7 }] }}
                  />
                ) : (
                  <Text
                    style={{ ...type.caption, color: t.color.textMuted }}
                    accessibilityLabel="Waiting to sync"
                  >
                    Pending
                  </Text>
                )
              ) : mineToEdit && !cancelled ? (
                /* The pencil shares the corner with the sync state rather than
                   sitting beside the title, so the row has exactly one place
                   that reports the event's standing. They are mutually
                   exclusive on purpose: while a write is in flight the sync
                   state is the more urgent fact, and a pencil offering an edit
                   on top of an unsettled write invites editing something that
                   has not landed yet. Cancelled events show neither, since they
                   are uncancelled rather than edited.

                   Alternatives if this reads as clutter: a muted "Yours" in the
                   meta line, or nothing at all, since the header pencil already
                   says it where it matters. */
                <Ionicons
                  name="pencil"
                  size={13}
                  color={t.color.textMuted}
                  accessibilityLabel="You can edit this"
                />
              ) : null}
              {event.rrule ? (
                <Text style={{ ...type.caption, color: t.color.textMuted }}>
                  Repeats
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
      </Link>

      {cancelled ? (
        <Text style={{ ...type.caption, color: t.color.danger }}>Cancelled</Text>
      ) : null}

      {/* Nobody RSVPs to themselves.
          
          On a calendar with one member, putting something in it IS the
          decision: three buttons asking whether you are going to your own
          dentist appointment is a question with one answer, and a summary
          reading "nobody replied" about a party of one is worse. Attendance
          returns the moment there is somebody else to attend with. */}
      {solo ? null : (
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <AvatarStack names={goingNames} />
          <Text
            numberOfLines={1}
            style={{ ...type.caption, color: t.color.textMuted, flex: 1 }}
          >
            {summarise(tally.going, tally.maybe, tally.noResponse)}
          </Text>
        </View>

        <RsvpControl
          compact
          fill
          cancelled={cancelled}
          value={mine.status as RsvpStatus | null}
          onChange={(next) =>
            next === null
              ? clearRsvp(event.event_id, occurrence)
              : setRsvp(event.calendar_id, event.event_id, occurrence, next)
          }
        />
      </View>
      )}
    </View>
  );
}

/**
 * "no response" is a distinct state from "not going" — absence of an item IS the
 * state — and saying so is what makes the organiser's nudge meaningful (§3.5).
 */
function summarise(going: number, maybe: number, noResponse: number): string {
  const parts: string[] = [];
  if (going > 0) parts.push(`${going} going`);
  if (maybe > 0) parts.push(`${maybe} maybe`);
  if (noResponse > 0) parts.push(`${noResponse} not replied`);
  return parts.length > 0 ? parts.join(" · ") : "No replies yet";
}
