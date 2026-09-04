import { Ionicons } from "@expo/vector-icons";
import type { RsvpStatus, TicketStatus } from "@calder/core";
import { canEditEvent } from "@calder/core";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";

import { Cover } from "@/components/Cover";
import { RsvpControl } from "@/components/RsvpControl";
import { SlotPoll } from "@/components/SlotPoll";
import { TicketControl } from "@/components/TicketControl";
import { Card, EmptyState, Muted } from "@/components/ui";
import {
  clearRsvp,
  getCalendar,
  getEvent,
  listMembers,
  listRsvps,
  listSlotVotes,
  listSlots,
  myMembership,
  resolveForUser,
  setMyTicketStatus,
  setRsvp,
  tallyForEvent,
} from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { formatClock, formatDayHeading, formatEventTime } from "@/lib/format";
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
  const router = useRouter();
  const { calendarId, eventId, from } = useLocalSearchParams<{
    calendarId: string;
    eventId: string;
    from?: string;
  }>();

  const event = useQuery(`event:${eventId}`, () => getEvent(eventId));
  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const members = useQuery(`members:${calendarId}`, () => listMembers(calendarId));
  const me = useQuery(`me:${calendarId}`, () => myMembership(calendarId));
  const rsvps = useQuery(`rsvps-event:${eventId}`, () => listRsvps(eventId));
  const slots = useQuery(`slots:${eventId}`, () => listSlots(eventId));
  const slotVotes = useQuery(`slot-votes:${eventId}`, () => listSlotVotes(eventId));

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
  /** A calendar of one. The same rule the agenda rows use. */
  const solo = members.length <= 1;

  const lookingNames = members
    .filter(
      (m) =>
        resolveForUser(rsvps, eventId, OCCURRENCE, m.user_id).item?.ticketStatus ===
        "looking",
    )
    .map((m) => m.display_name);

  return (
    <>
      {/* The calendar's name in the header, so the event is placed before you
          have read a word of it. */}
      <Stack.Screen
        options={{
          title: calendar?.name ?? "",
          headerRight: () =>
            canEditEvent({
              createdBy: event.created_by,
              userId: CURRENT_USER_ID,
              role: me?.role ?? null,
              status: event.status,
            }) ? (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/calendar/[calendarId]/event/edit/[eventId]",
                    params: { calendarId, eventId },
                  })
                }
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Edit this event"
              >
                <Ionicons name="pencil" size={20} color={t.color.accent} />
              </Pressable>
            ) : null,
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Cover value={event.image_key} height={140} />

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
          {/* The start is the fact people act on — it decides when to leave —
              so it carries the weight, and the end trails it in the muted
              colour. Rendered as "20:30 – 23:00" in one size, the two times
              looked equally important and you had to read the dash to tell
              which was which. */}
          {event.precision === "datetime" ? (
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
              <Text style={{ ...type.title, fontSize: 22, color: t.color.text }}>
                {formatClock(event.start_utc, event.tz)}
              </Text>
              {event.end_utc ? (
                <Text style={{ ...type.body, color: t.color.textMuted }}>
                  until {formatClock(event.end_utc, event.tz)}
                  {/* A finish before the start is the small hours, and saying so
                      is the difference between a late night and a typo. */}
                  {event.end_utc.slice(0, 10) !== event.start_utc.slice(0, 10)
                    ? " next day"
                    : ""}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={{ ...type.body, color: t.color.text }}>
              {formatEventTime({
                startUtc: event.start_utc,
                endUtc: event.end_utc ?? undefined,
                tz: event.tz,
                localWall: event.local_wall,
                precision: event.precision,
              })}
            </Text>
          )}
          {/* Times render in the EVENT's zone, not the phone's (§5.5). */}
          {calendar && event.tz !== calendar.default_tz ? (
            <Muted>Times shown in {event.tz}</Muted>
          ) : null}
        </View>

        {/* Reached from the agenda, an event arrives with no context about where
            it came from: the same five-a-side means something different in a
            London calendar than in a stag weekend. Naming the calendar and
            making it a way in beats making people go back and hunt for it.
            Arriving FROM that calendar, the link is a journey already made, so
            the caller says so and it is dropped. */}
        {calendar && from !== "calendar" ? (
          <Link
            href={{
              pathname: "/calendar/[calendarId]",
              params: { calendarId },
            }}
            asChild
          >
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Go to ${calendar.name}`}
            >
              <Card
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                }}
              >
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color={t.color.accent}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...type.label, color: t.color.text }}>
                    {calendar.name}
                  </Text>
                  <Muted>Go to this calendar</Muted>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color={t.color.textMuted}
                />
              </Card>
            </Pressable>
          </Link>
        ) : null}

        {/* While the time is unsettled the poll IS the interaction: asking for
            an RSVP to a date that may not happen collects answers about the
            wrong question and has to be asked again afterwards. */}
        {event.scheduling_mode !== "fixed" ? (
          <SlotPoll
            eventId={eventId}
            mode={event.scheduling_mode}
            slots={slots}
            votes={slotVotes}
            members={members}
            canDecide={canEditEvent({
              createdBy: event.created_by,
              userId: CURRENT_USER_ID,
              role: me?.role ?? null,
              status: event.status,
            })}
            isEventOwner={event.created_by === CURRENT_USER_ID}
            myRole={me?.role ?? null}
            onAddSlot={() =>
              router.push({
                pathname: "/calendar/[calendarId]/event/slot/[eventId]",
                params: { calendarId, eventId },
              })
            }
          />
        ) : null}

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

        {/* A calendar of one has nobody to answer to: putting it in your own
            calendar IS the answer, and asking again turns a note to yourself
            into a question. Not "is it private" — a two-person private calendar
            still has someone waiting on your reply. */}
        {solo ? null : (
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>Are you going?</Text>
          <RsvpControl
            cancelled={event.status === "cancelled"}
            value={mine.status as RsvpStatus | null}
            onChange={(next) =>
              next === null
                ? clearRsvp(eventId, OCCURRENCE)
                : setRsvp(calendarId, eventId, OCCURRENCE, next)
            }
          />
        </View>
        )}

        {solo ? null : (
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
        )}

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
