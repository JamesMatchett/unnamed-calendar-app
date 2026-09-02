import { Ionicons } from "@expo/vector-icons";
import type { RsvpStatus, TicketStatus } from "@uca/core";
import { Stack, useLocalSearchParams } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";

import { RsvpControl } from "@/components/RsvpControl";
import { TicketControl } from "@/components/TicketControl";
import { Card, EmptyState, Muted } from "@/components/ui";
import {
  getCalendar,
  getEvent,
  listMembers,
  listRsvps,
  resolveForUser,
  setMyTicketStatus,
  setRsvp,
  tallyForEvent,
} from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { formatDayHeading, formatEventTime } from "@/lib/format";
import { openMap } from "@/lib/maps";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

const OCCURRENCE = "-";

/**
 * Event detail: name, time, location, who's going, tickets (§3.5).
 *
 * Editing, suggestions and cancellation are designed in §8 but not built here —
 * this slice exists to test whether the hierarchy and the attendance model feel
 * right, which they can only do with real content in front of them.
 */
export default function EventScreen() {
  const t = useTheme();
  const { calendarId, eventId } = useLocalSearchParams<{
    calendarId: string;
    eventId: string;
  }>();

  const event = useQuery(`event:${eventId}`, () => getEvent(eventId));
  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const members = useQuery(`members:${calendarId}`, () => listMembers(calendarId));
  const rsvps = useQuery(`rsvps-event:${eventId}`, () => listRsvps(eventId));

  if (!event) {
    return <EmptyState title="Event not found" body="It may have been deleted." />;
  }

  const mine = resolveForUser(rsvps, eventId, OCCURRENCE, CURRENT_USER_ID);
  const tally = tallyForEvent(rsvps, eventId, OCCURRENCE, members);

  const byStatus = (status: RsvpStatus) =>
    members.filter(
      (m) => resolveForUser(rsvps, eventId, OCCURRENCE, m.user_id).status === status,
    );

  const noReply = members.filter(
    (m) => resolveForUser(rsvps, eventId, OCCURRENCE, m.user_id).status === null,
  );

  const author = members.find((m) => m.user_id === event.created_by);

  const lookingNames = members
    .filter(
      (m) =>
        resolveForUser(rsvps, eventId, OCCURRENCE, m.user_id).item?.ticketStatus ===
        "looking",
    )
    .map((m) => m.display_name);

  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <Text
            style={{
              ...type.title,
              color: t.color.text,
              textDecorationLine: event.status === "cancelled" ? "line-through" : "none",
            }}
          >
            {event.title}
          </Text>
          {event.status === "cancelled" ? (
            <Text style={{ ...type.label, color: t.color.danger }}>Cancelled</Text>
          ) : null}
          <Text style={{ ...type.body, color: t.color.textMuted }}>
            {formatDayHeading(event.start_utc, event.tz)}
          </Text>
          <Text style={{ ...type.body, color: t.color.text }}>
            {formatEventTime({
              startUtc: event.start_utc,
              endUtc: event.end_utc ?? undefined,
              tz: event.tz,
              localWall: event.local_wall,
              precision: event.precision,
            })}
          </Text>
          {/* Times render in the EVENT's zone, not the phone's (§5.5). */}
          {calendar && event.tz !== calendar.default_tz ? (
            <Muted>Times shown in {event.tz}</Muted>
          ) : null}
        </View>

        {event.description ? (
          <Text style={{ ...type.body, color: t.color.text }}>{event.description}</Text>
        ) : null}

        {event.location_name ? (
          <Pressable
            onPress={() => {
              void openMap({
                name: event.location_name,
                address: event.location_address,
              });
            }}
            accessibilityRole="button"
            accessibilityLabel={`Open ${event.location_name} in maps`}
          >
            <Card
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
              }}
            >
              <Ionicons name="location-outline" size={20} color={t.color.accent} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.label, color: t.color.text }}>
                  {event.location_name}
                </Text>
                {event.location_address ? (
                  <Muted>{event.location_address}</Muted>
                ) : null}
              </View>
              <Ionicons
                name="chevron-forward"
                size={17}
                color={t.color.textMuted}
              />
            </Card>
          </Pressable>
        ) : null}

        {event.tickets_required === 1 ? (
          <Card style={{ gap: space.md }}>
            <Text style={{ ...type.label, color: t.color.text }}>Tickets</Text>

            <View style={{ gap: space.sm }}>
              <Muted>Have you got one?</Muted>
              <TicketControl
                value={(mine.item?.ticketStatus ?? null) as TicketStatus | null}
                onChange={(next) =>
                  setMyTicketStatus(calendarId, eventId, OCCURRENCE, next)
                }
              />
            </View>

            <Muted>{describeTickets(tally.tickets)}</Muted>

            {/* Surfaced separately because it is the one state other people can
                act on: whoever has a spare can see who needs it. */}
            {lookingNames.length > 0 ? (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
              >
                <Ionicons name="search-outline" size={15} color={t.color.maybe} />
                <Text style={{ ...type.caption, color: t.color.maybe, flex: 1 }}>
                  {lookingNames.join(", ")}{" "}
                  {lookingNames.length === 1 ? "needs" : "need"} a ticket
                </Text>
              </View>
            ) : null}

            {event.ticket_url ? (
              <Pressable
                onPress={() => {
                  void Linking.openURL(event.ticket_url as string);
                }}
                style={{
                  alignSelf: "flex-start",
                  marginTop: space.xs,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: t.color.accentSoft,
                }}
              >
                <Text style={{ ...type.label, color: t.color.accent }}>
                  {/* Someone who already has one is buying for a friend, not
                      repeating themselves. */}
                  {mine.item?.ticketStatus === "have"
                    ? "Get more tickets"
                    : "Get tickets"}
                </Text>
              </Pressable>
            ) : null}
          </Card>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>Are you going?</Text>
          <RsvpControl
            value={mine.status as RsvpStatus | null}
            onChange={(next) => setRsvp(calendarId, eventId, OCCURRENCE, next)}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>Who's going</Text>
          <Card style={{ gap: space.md }}>
            <Attendees label="Going" names={byStatus("going").map((m) => m.display_name)} color={t.color.going} />
            <Attendees label="Maybe" names={byStatus("maybe").map((m) => m.display_name)} color={t.color.maybe} />
            <Attendees label="Can't go" names={byStatus("not_going").map((m) => m.display_name)} color={t.color.notGoing} />
            {/* No reply is its own state — absence of an answer, not a no (§3.5). */}
            <Attendees label="No reply yet" names={noReply.map((m) => m.display_name)} color={t.color.textMuted} />
          </Card>
        </View>

        {author ? <Muted>Added by {author.display_name}</Muted> : null}
      </ScrollView>
    </>
  );
}

function Attendees({
  label,
  names,
  color,
}: {
  label: string;
  names: readonly string[];
  color: string;
}) {
  const t = useTheme();
  if (names.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <Text style={{ ...type.caption, color, width: 80 }}>{label}</Text>
      <Text style={{ ...type.caption, color: t.color.text, flex: 1 }}>
        {names.join(", ")}
      </Text>
    </View>
  );
}

/**
 * Reads as a sentence rather than a row of counters. "Nobody has sorted a
 * ticket" is a more useful thing to see than "0 have".
 */
function describeTickets(t: {
  have: number;
  looking: number;
  none: number;
  unsaid: number;
}): string {
  const coming = t.have + t.looking + t.none + t.unsaid;
  if (coming === 0) return "Nobody has said they're coming yet.";
  if (t.have === coming) return "Everyone coming has a ticket.";

  const parts: string[] = [];
  if (t.have > 0) parts.push(`${t.have} sorted`);
  if (t.looking > 0) parts.push(`${t.looking} looking`);
  if (t.none > 0) parts.push(`${t.none} without`);
  if (t.unsaid > 0) parts.push(`${t.unsaid} haven't said`);
  return parts.join(" · ");
}
