import { Ionicons } from "@expo/vector-icons";
import { dayBoundsIn } from "@calder/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect, useMemo } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { Cover } from "@/components/Cover";
import { DayPills } from "@/components/DayPills";
import { DayBoard } from "@/components/DayBoard";
import { DayPresenceNote } from "@/components/DayPresenceNote";
import { EventRow } from "@/components/EventRow";
import { AvatarStack, Card, EmptyState, Muted } from "@/components/ui";
import type { CalendarRow } from "@/db/repo";
import {
  getCalendar,
  listEvents,
  listMembers,
  listRsvpsForCalendar,
  myMembership,
  presenceForDay,
} from "@/db/repo";
import { dayKey, formatDateRange, formatDayShort } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * The calendar screen: name, description, date range, a day selector, the member
 * list, and upcoming events (§3.5). Tapping a day drills in; tapping an event
 * opens it.
 */
export default function CalendarScreen() {
  const t = useTheme();
  const router = useRouter();
  const { calendarId, created } = useLocalSearchParams<{
    calendarId: string;
    created?: string;
  }>();

  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const events = useQuery(`events:${calendarId}`, () => listEvents(calendarId));
  const members = useQuery(`members:${calendarId}`, () => listMembers(calendarId));
  const rsvps = useQuery(`rsvps:${calendarId}`, () => listRsvpsForCalendar(calendarId));
  const me = useQuery(`me:${calendarId}`, () => myMembership(calendarId));

  const tz = calendar?.default_tz ?? "Europe/London";

  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  /**
   * Sideways is a different question, so it gets a different view: a board of
   * day columns rather than one day at a time. Unlocked on the way in and put
   * back to portrait on the way out, so the rest of the app keeps its own
   * orientation policy.
   */
  useEffect(() => {
    void ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      void ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {});
    };
  }, []);

  const { days, counts } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      const k = dayKey(e.start_utc, tz);
      counts[k] = (counts[k] ?? 0) + 1;
    }

    // Bounded calendars show every day of the trip, including empty ones — the
    // gaps are information. Continuous calendars only show days that have
    // something on them, because the range is unbounded (§3.5).
    if (calendar?.mode === "bounded" && calendar.start_date && calendar.end_date) {
      const out: string[] = [];
      const cursor = new Date(`${calendar.start_date}T12:00:00.000Z`);
      const end = new Date(`${calendar.end_date}T12:00:00.000Z`);
      while (cursor <= end) {
        out.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      // Anything OUTSIDE the trip dates is added too. Building the list from
      // the range alone silently swallowed events on any other day: they were
      // saved, counted, and never drawn, which reads exactly like the app
      // having lost them. A calendar must never hold an event it will not show.
      const strays = Object.keys(counts).filter((d) => !out.includes(d));
      return { days: [...out, ...strays].sort(), counts };
    }

    return { days: Object.keys(counts).sort(), counts };
  }, [events, calendar, tz]);

  if (!calendar) return <EmptyState title="Not found" body="This calendar is no longer available." />;

  const canAdd =
    me?.role === "owner" || calendar.allow_member_events === 1;

  const range = formatDateRange(
    calendar.start_date ?? undefined,
    calendar.end_date ?? undefined,
  );

  if (landscape) {
    return (
      <>
        <Stack.Screen options={{ title: calendar.name }} />
        <View style={{ flex: 1, paddingTop: space.sm, gap: space.sm }}>
          <Text
            style={{
              ...type.label,
              color: t.color.textMuted,
              paddingHorizontal: space.lg,
            }}
          >
            {calendar.name}
            {range ? ` · ${range}` : ""}
          </Text>
          <DayBoard
            calendarId={calendarId}
            today={dayKey(new Date().toISOString(), tz)}
            rsvps={rsvps}
            days={days.map((d) => ({
              date: d,
              events: events
                .filter((e) => dayKey(e.start_utc, tz) === d)
                .sort((a, b) => (a.start_utc < b.start_utc ? -1 : 1)),
            }))}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: calendar.name,
          headerRight: () => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/calendar/[calendarId]/settings",
                  params: { calendarId },
                })
              }
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Calendar settings"
            >
              <Ionicons name="settings-outline" size={21} color={t.color.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.lg,
          // Clears the floating Add button, which otherwise sits on top of the
          // last event in the list.
          paddingBottom: 96,
          gap: space.lg,
        }}
      >
        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          <Cover value={calendar.cover_image} />
          <Text style={{ ...type.title, color: t.color.text }}>{calendar.name}</Text>
          {calendar.description ? (
            <Text style={{ ...type.body, color: t.color.textMuted }}>
              {calendar.description}
            </Text>
          ) : null}
          <Muted>
            {range ?? "Ongoing"} · {members.length}{" "}
            {members.length === 1 ? "person" : "people"}
          </Muted>
        </View>

        {created === "1" ? (
          /* Creation is not finished until there is something in the calendar
             and somebody else in it (§3.5). A brand-new calendar therefore says
             what happens next rather than presenting an empty room. */
          <View style={{ paddingHorizontal: space.lg }}>
            <Card style={{ gap: space.sm, borderColor: t.color.accent }}>
              <Text style={{ ...type.label, color: t.color.accent }}>
                Two things left
              </Text>
              <Text style={{ ...type.body, color: t.color.text }}>
                Add the first thing so there's something to look at, then invite
                the others.
              </Text>
              <Muted>
                An empty calendar nobody else is in doesn't do much.
              </Muted>
            </Card>
          </View>
        ) : null}

        <View style={{ paddingHorizontal: space.lg }}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <AvatarStack names={members.map((m) => m.display_name)} />
            <Text style={{ ...type.caption, color: t.color.textMuted, flex: 1 }}>
              {members.map((m) => m.display_name).join(", ")}
            </Text>
          </Card>
        </View>

        {days.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Text
              style={{
                ...type.label,
                color: t.color.textMuted,
                paddingHorizontal: space.lg,
              }}
            >
              Jump to a day
            </Text>
            <DayPills
              days={days}
              tz={tz}
              selected={null}
              counts={counts}
              onSelect={(d) =>
                router.push({
                  pathname: "/calendar/[calendarId]/day/[date]",
                  params: { calendarId, date: d },
                })
              }
            />
          </View>
        ) : null}

        <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Upcoming
          </Text>

          {days.length === 0 ? (
            <EmptyState
              title="Nothing planned yet"
              body="Add the first thing: a dinner, a flight, a vague intention to go to the beach."
              actionLabel="Add an event"
              onAction={() => router.push(addEventHref(calendarId))}
            />
          ) : (
            days.map((d) => (
              <DaySection
                key={d}
                calendarId={calendarId}
                date={d}
                tz={tz}
                collectAvailability={calendar.collect_availability === 1}
                travelMode={calendar.travel_mode}
                events={events.filter((e) => dayKey(e.start_utc, tz) === d)}
                members={members}
                rsvps={rsvps}
                outsideTrip={
                  calendar.mode === "bounded" &&
                  !!calendar.start_date &&
                  !!calendar.end_date &&
                  (d < calendar.start_date || d > calendar.end_date)
                }
              />
            ))
          )}
        </View>

      </ScrollView>

      {canAdd ? (
        <Pressable
          onPress={() => router.push(addEventHref(calendarId))}
          accessibilityRole="button"
          accessibilityLabel="Add an event"
          style={{
            position: "absolute",
            right: space.lg,
            bottom: space.xl,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.xl,
            paddingVertical: space.md,
            borderRadius: radius.pill,
            backgroundColor: t.color.accentFill,
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          }}
        >
          <Ionicons name="add" size={19} color={t.color.onAccent} />
          <Text style={{ ...type.label, color: t.color.onAccent }}>Add</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const addEventHref = (calendarId: string) =>
  ({
    pathname: "/calendar/[calendarId]/event/new",
    params: { calendarId },
  }) as const;

/**
 * One day in the calendar's list: the date, who is coming or going, then what is
 * planned. Days with no events still appear when someone arrives or leaves —
 * "nothing planned, but Luke lands at 18:30" is exactly the sort of thing the
 * list exists to tell you, and it is why arrivals used to be fake events.
 */
function DaySection({
  calendarId,
  date,
  tz,
  collectAvailability,
  travelMode,
  events,
  members,
  rsvps,
  outsideTrip,
}: {
  calendarId: string;
  date: string;
  tz: string;
  collectAvailability: boolean;
  travelMode: CalendarRow["travel_mode"];
  events: ReturnType<typeof listEvents>;
  members: ReturnType<typeof listMembers>;
  rsvps: ReturnType<typeof listRsvpsForCalendar>;
  /** Flagged rather than hidden, so a mis-dated event is obvious and fixable. */
  outsideTrip?: boolean;
}) {
  const t = useTheme();
  const bounds = dayBoundsIn(date, tz);
  const presence = useQuery(`presence:${calendarId}:${date}`, () =>
    presenceForDay(calendarId, bounds.dayStart, bounds.dayEnd),
  );

  const movement =
    collectAvailability &&
    (presence.arrivingToday.length > 0 || presence.leavingToday.length > 0);

  if (events.length === 0 && !movement) return null;

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
        <Text style={{ ...type.label, color: t.color.text }}>
          {formatDayShort(date, tz)}
        </Text>
        {outsideTrip ? (
          <Text style={{ ...type.caption, color: t.color.maybe }}>
            Outside the dates
          </Text>
        ) : null}
      </View>

      {collectAvailability ? (
        <DayPresenceNote presence={presence} tz={tz} travelMode={travelMode} />
      ) : null}

      {events.map((e) => (
        <EventRow
                  key={e.event_id}
                  event={e}
                  rsvps={rsvps}
                  from="calendar"
                />
      ))}

      {events.length === 0 ? (
        <Text style={{ ...type.caption, color: t.color.textMuted }}>
          Nothing planned.
        </Text>
      ) : null}
    </View>
  );
}
