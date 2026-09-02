import { dayBoundsIn } from "@uca/core";
import * as ScreenOrientation from "expo-screen-orientation";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DayTimeline } from "@/components/DayTimeline";
import { EventRow } from "@/components/EventRow";
import { PresenceStrip } from "@/components/PresenceStrip";
import { EmptyState } from "@/components/ui";
import {
  getCalendar,
  listEvents,
  listMembers,
  listRsvpsForCalendar,
  presenceForDay,
} from "@/db/repo";
import { dayKey, formatDayHeading } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

/**
 * One day. Two presentations, chosen by how the phone is held:
 *
 *   portrait  — the list, consistent with every other screen
 *   landscape — an hour grid, where overlaps are visible rather than inferred
 *
 * Rotation is unlocked ONLY here. Everywhere else the app stays portrait, so
 * turning the phone is a deliberate affordance on the one screen where a second
 * view genuinely says something different, rather than a global behaviour that
 * every screen then has to be designed for.
 */
export default function DayScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { calendarId, date } = useLocalSearchParams<{
    calendarId: string;
    date: string;
  }>();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  useEffect(() => {
    void ScreenOrientation.unlockAsync();
    return () => {
      void ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
    };
  }, []);

  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const events = useQuery(`events:${calendarId}`, () => listEvents(calendarId));
  const members = useQuery(`members:${calendarId}`, () => listMembers(calendarId));
  const rsvps = useQuery(`rsvps:${calendarId}`, () => listRsvpsForCalendar(calendarId));

  const tz = calendar?.default_tz ?? "Europe/London";
  const onThisDay = events.filter((e) => dayKey(e.start_utc, tz) === date);

  const bounds = dayBoundsIn(date, tz);
  const presence = useQuery(`presence:${calendarId}:${date}`, () =>
    presenceForDay(calendarId, bounds.dayStart, bounds.dayEnd),
  );
  const showPresence = calendar?.collect_availability === 1;

  if (onThisDay.length === 0 && !showPresence) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DayHeader
          title={formatDayHeading(`${date}T12:00:00.000Z`, tz)}
          insetTop={insets.top}
          onBack={() => router.back()}
        />
        <EmptyState
          title="Nothing on this day"
          body="A free day is a feature, not a bug. Add something if you'd rather it weren't."
          actionLabel="Add an event"
        />
      </>
    );
  }

  if (landscape) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ flex: 1, paddingTop: insets.top > 0 ? space.xs : space.sm }}>
          <Text
            style={{
              ...type.label,
              color: t.color.textMuted,
              paddingHorizontal: space.lg,
              paddingBottom: space.xs,
            }}
          >
            {formatDayHeading(`${date}T12:00:00.000Z`, tz)} · {calendar?.name}
          </Text>
          <DayTimeline
            date={date}
            tz={tz}
            events={onThisDay}
            members={members}
            rsvps={rsvps}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DayHeader
        title={formatDayHeading(`${date}T12:00:00.000Z`, tz)}
        insetTop={insets.top}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <View style={{ gap: space.lg }}>
          {showPresence ? (
            <View style={{ gap: space.sm }}>
              <Text style={{ ...type.label, color: t.color.textMuted }}>
                Who's around
              </Text>
              <PresenceStrip
                presence={presence}
                tz={tz}
                travelMode={calendar?.travel_mode ?? "plane"}
              />
            </View>
          ) : null}

          <View style={{ gap: space.sm }}>
            {onThisDay.length === 0 ? (
              <Text style={{ ...type.body, color: t.color.textMuted }}>
                Nothing planned yet.
              </Text>
            ) : (
              onThisDay.map((e) => (
                <EventRow key={e.event_id} event={e} members={members} rsvps={rsvps} />
              ))
            )}
          </View>

          <Text
            style={{
              ...type.caption,
              color: t.color.textMuted,
              textAlign: "center",
            }}
          >
            Turn your phone sideways for the hour-by-hour view
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

/**
 * The day screen owns its header rather than letting the navigator draw one.
 *
 * The navigator's header cannot be shown in one orientation and hidden in the
 * other without it measuring itself against the wrong frame: rotating to
 * landscape and back left the bar positioned off the top of the screen. Drawing
 * it here means the orientation change moves nothing the navigator has to
 * re-measure.
 */
function DayHeader({
  title,
  insetTop,
  onBack,
}: {
  title: string;
  insetTop: number;
  onBack: () => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        paddingTop: insetTop,
        backgroundColor: t.color.bg,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ flexDirection: "row", alignItems: "center" }}
        >
          <Ionicons name="chevron-back" size={26} color={t.color.accent} />
        </Pressable>
        <Text style={{ ...type.heading, fontSize: 17, color: t.color.text }}>
          {title}
        </Text>
      </View>
    </View>
  );
}
