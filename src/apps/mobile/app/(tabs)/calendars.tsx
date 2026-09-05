import { Ionicons } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Cover } from "@/components/Cover";
import { AvatarStack, Card, EmptyState } from "@/components/ui";
import { listCalendars, listEvents, listMembers } from "@/db/repo";
import { formatDateRange } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

export default function CalendarsScreen() {
  const t = useTheme();
  const router = useRouter();
  const calendars = useQuery("calendars", () => listCalendars());

  if (calendars.length === 0) {
    return (
      <EmptyState
        title="No calendars yet"
        body="A calendar is a shared space for a trip, a festival, or just what everyone's up to this month."
        actionLabel="Create one"
        onAction={() => router.push("/calendar/new")}
      />
    );
  }

  // Private first: they are the person's own, and burying them under trips they
  // share with other people gets the emphasis backwards.
  const priv = calendars.filter((c) => c.is_private === 1);
  const bounded = calendars.filter((c) => c.is_private !== 1 && c.mode === "bounded");
  const continuous = calendars.filter(
    (c) => c.is_private !== 1 && c.mode === "continuous",
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: 96, gap: space.xl }}
      >
      {priv.length > 0 ? (
        <Section title="Private">
          {priv.map((c) => (
            <CalendarCard key={c.calendar_id} calendar={c} />
          ))}
        </Section>
      ) : null}

      {bounded.length > 0 ? (
        <Section title="Trips, Holidays, Festivals and more">
          {bounded.map((c) => (
            <CalendarCard key={c.calendar_id} calendar={c} />
          ))}
        </Section>
      ) : null}

      {continuous.length > 0 ? (
        <Section title="Ongoing calendars">
          {continuous.map((c) => (
            <CalendarCard key={c.calendar_id} calendar={c} />
          ))}
        </Section>
      ) : null}
      </ScrollView>

      {/* Creating is the action this screen exists to make easy, so it stays
          reachable without scrolling to the bottom of a long list. */}
      <Pressable
        onPress={() => router.push("/calendar/new")}
        accessibilityRole="button"
        accessibilityLabel="New calendar"
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
        <Text style={{ ...type.label, color: t.color.onAccent }}>New</Text>
      </Pressable>
    </View>
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
          <Cover value={calendar.cover_image} height={96} />

          <View
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
          >
            <Text style={{ ...type.heading, color: t.color.text, flex: 1 }}>
              {calendar.name}
            </Text>
            {/* Not on private calendars: they are yours by definition, and a
                badge that is always there on a whole section says nothing. It
                earns its place only where some calendars are yours and some are
                not. */}
            {calendar.my_role === "owner" && calendar.is_private !== 1 ? (
              <OwnerBadge />
            ) : null}
          </View>
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

/**
 * Marks the calendars this person runs, so "can I change this?" is answerable
 * from the list rather than by opening each one and looking for the controls.
 */
function OwnerBadge() {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: t.color.going,
      }}
    >
      <Ionicons name="key-outline" size={11} color={t.color.going} />
      <Text
        style={{
          ...type.caption,
          fontSize: 11,
          fontWeight: "700",
          color: t.color.going,
        }}
      >
        Owner
      </Text>
    </View>
  );
}
