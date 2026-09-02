import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AvatarStack, Card, EmptyState } from "@/components/ui";
import { listCalendars, listEvents, listMembers } from "@/db/repo";
import { formatDateRange } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

export default function CalendarsScreen() {
  const calendars = useQuery("calendars", () => listCalendars());

  if (calendars.length === 0) {
    return (
      <EmptyState
        title="No calendars yet"
        body="A calendar is a shared space for a trip, a festival, or just what everyone's up to this month."
        actionLabel="Create one"
      />
    );
  }

  const bounded = calendars.filter((c) => c.mode === "bounded");
  const continuous = calendars.filter((c) => c.mode === "continuous");

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
      {bounded.length > 0 ? (
        <Section title="Trips and dates">
          {bounded.map((c) => (
            <CalendarCard key={c.calendar_id} calendar={c} />
          ))}
        </Section>
      ) : null}

      {continuous.length > 0 ? (
        <Section title="Ongoing">
          {continuous.map((c) => (
            <CalendarCard key={c.calendar_id} calendar={c} />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ ...type.label, color: t.color.textMuted }}>{title}</Text>
      {children}
    </View>
  );
}

function CalendarCard({
  calendar,
}: {
  calendar: ReturnType<typeof listCalendars>[number];
}) {
  const t = useTheme();
  const members = useQuery(`members:${calendar.calendar_id}`, () =>
    listMembers(calendar.calendar_id),
  );
  const events = useQuery(`events:${calendar.calendar_id}`, () =>
    listEvents(calendar.calendar_id),
  );

  const range = formatDateRange(
    calendar.start_date ?? undefined,
    calendar.end_date ?? undefined,
  );

  return (
    <Link
      href={{
        pathname: "/calendar/[calendarId]",
        params: { calendarId: calendar.calendar_id },
      }}
      asChild
    >
      <Pressable accessibilityRole="link">
        <Card style={{ gap: space.sm }}>
          <Text style={{ ...type.heading, color: t.color.text }}>{calendar.name}</Text>
          {calendar.description ? (
            <Text style={{ ...type.caption, color: t.color.textMuted }} numberOfLines={2}>
              {calendar.description}
            </Text>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: space.xs,
            }}
          >
            {/* Showing faces matters disproportionately: a calendar with people
                in it and no events reads as a beginning, not as broken (§3.5). */}
            <AvatarStack names={members.map((m) => m.display_name)} />
            <Text style={{ ...type.caption, color: t.color.textMuted }}>
              {range ? `${range} · ` : ""}
              {events.length} {events.length === 1 ? "event" : "events"}
            </Text>
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}
