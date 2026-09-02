import type { RsvpStatus } from "@uca/core";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { EventRow as EventRowData, MemberRow, RsvpRow } from "@/db/repo";
import { resolveForUser, setRsvp, tallyForEvent } from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { formatEventTime } from "@/lib/format";
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
}: {
  event: EventRowData;
  members: readonly MemberRow[];
  rsvps: readonly RsvpRow[];
  subtitle?: string;
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
        opacity: event.sync_state === "pending" ? 0.6 : 1,
      }}
    >
      <Link
        href={{
          pathname: "/calendar/[calendarId]/event/[eventId]",
          params: { calendarId: event.calendar_id, eventId: event.event_id },
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
            {event.rrule ? (
              <Text style={{ ...type.caption, color: t.color.textMuted }}>Repeats</Text>
            ) : null}
          </View>
        </Pressable>
      </Link>

      {cancelled ? (
        <Text style={{ ...type.caption, color: t.color.danger }}>Cancelled</Text>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.sm,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <AvatarStack names={goingNames} />
          <Text style={{ ...type.caption, color: t.color.textMuted }}>
            {summarise(tally.going, tally.maybe, tally.noResponse)}
          </Text>
        </View>

        <RsvpControl
          compact
          value={mine.status as RsvpStatus | null}
          onChange={(next) =>
            setRsvp(event.calendar_id, event.event_id, occurrence, next)
          }
        />
      </View>
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
