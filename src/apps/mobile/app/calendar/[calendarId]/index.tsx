import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { DayPills } from "@/components/DayPills";
import { EventRow } from "@/components/EventRow";
import { AvatarStack, Card, EmptyState, Muted } from "@/components/ui";
import {
  getCalendar,
  listEvents,
  listMembers,
  listRsvpsForCalendar,
} from "@/db/repo";
import { dayKey, formatDateRange } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

/**
 * The calendar screen: name, description, date range, a day selector, the member
 * list, and upcoming events (§3.5). Tapping a day drills in; tapping an event
 * opens it.
 */
export default function CalendarScreen() {
  const t = useTheme();
  const router = useRouter();
  const { calendarId } = useLocalSearchParams<{ calendarId: string }>();

  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const events = useQuery(`events:${calendarId}`, () => listEvents(calendarId));
  const members = useQuery(`members:${calendarId}`, () => listMembers(calendarId));
  const rsvps = useQuery(`rsvps:${calendarId}`, () => listRsvpsForCalendar(calendarId));

  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const tz = calendar?.default_tz ?? "Europe/London";

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
      return { days: out, counts };
    }

    return { days: Object.keys(counts).sort(), counts };
  }, [events, calendar, tz]);

  if (!calendar) return <EmptyState title="Not found" body="This calendar is no longer available." />;

  const range = formatDateRange(
    calendar.start_date ?? undefined,
    calendar.end_date ?? undefined,
  );

  const visible = selectedDay
    ? events.filter((e) => dayKey(e.start_utc, tz) === selectedDay)
    : events;

  return (
    <>
      <Stack.Screen options={{ title: calendar.name }} />
      <ScrollView contentContainerStyle={{ paddingVertical: space.lg, gap: space.lg }}>
        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
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
              {selectedDay ? "Showing one day" : "Jump to a day"}
            </Text>
            <DayPills
              days={days}
              tz={tz}
              selected={selectedDay}
              counts={counts}
              onSelect={(d) => {
                setSelectedDay(d);
                router.push({
                  pathname: "/calendar/[calendarId]/day/[date]",
                  params: { calendarId, date: d },
                });
              }}
            />
          </View>
        ) : null}

        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            {selectedDay ? "That day" : "Upcoming"}
          </Text>

          {visible.length === 0 ? (
            <EmptyState
              title="Nothing planned yet"
              body="Add the first thing — a dinner, a flight, a vague intention to go to the beach."
              actionLabel="Add an event"
            />
          ) : (
            visible.map((e) => (
              <EventRow key={e.event_id} event={e} members={members} rsvps={rsvps} />
            ))
          )}
        </View>
      </ScrollView>
    </>
  );
}
