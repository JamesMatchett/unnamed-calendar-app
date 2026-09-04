import type { RsvpStatus } from "@calder/core";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { EventRow, RsvpRow } from "@/db/repo";
import { resolveForUser } from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { formatEventTime } from "@/lib/format";
import { radius, space, type, useTheme } from "@/theme";

export interface BoardDay {
  /** YYYY-MM-DD in the calendar's zone. */
  date: string;
  events: readonly EventRow[];
}

const COLUMN = 220;

/**
 * A calendar turned sideways: one column per day, events down each column.
 *
 * Portrait can only show a day at a time, which is the right shape for "what
 * am I doing next" and the wrong one for "how does this trip hang together".
 * Landscape has the width for several days at once, so the question it answers
 * is the comparative one: which evening is empty, where three things collide,
 * whether the last day is packed before a midday flight.
 *
 * Deliberately NOT the hour grid the single-day landscape view uses. A grid
 * needs a real duration on every block, and across a week of mostly untimed
 * social plans it draws mostly guesses; a column of events in order claims only
 * what the data actually says. Empty days keep their column for the same
 * reason: a gap in a trip is information, not an absence of it.
 */
export function DayBoard({
  calendarId,
  days,
  rsvps,
  today,
}: {
  calendarId: string;
  days: readonly BoardDay[];
  rsvps: readonly RsvpRow[];
  /** YYYY-MM-DD, so the current day can be marked. */
  today: string;
}) {
  const t = useTheme();
  const router = useRouter();

  const tone = (status: RsvpStatus | null) =>
    status === "going"
      ? t.color.going
      : status === "maybe"
        ? t.color.maybe
        : status === "not_going"
          ? t.color.notGoing
          : t.color.border;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: space.lg,
        paddingBottom: space.lg,
        gap: space.md,
      }}
    >
      {days.map((day) => {
        const isToday = day.date === today;

        return (
          <View key={day.date} style={{ width: COLUMN, gap: space.sm }}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/calendar/[calendarId]/day/[date]",
                  params: { calendarId, date: day.date },
                })
              }
              disabled={day.events.length === 0}
              accessibilityRole="button"
              style={{
                paddingBottom: space.xs,
                borderBottomWidth: 2,
                borderBottomColor: isToday ? t.color.accent : t.color.border,
              }}
            >
              <Text
                style={{
                  ...type.caption,
                  color: isToday ? t.color.accent : t.color.textMuted,
                }}
              >
                {weekday(day.date)}
              </Text>
              <Text
                style={{
                  ...type.label,
                  fontSize: 16,
                  color: isToday ? t.color.accent : t.color.text,
                }}
              >
                {dayAndMonth(day.date)}
              </Text>
            </Pressable>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: space.sm, paddingBottom: space.xl }}
            >
              {day.events.length === 0 ? (
                <Text style={{ ...type.caption, color: t.color.textMuted }}>
                  Nothing yet
                </Text>
              ) : null}

              {day.events.map((e) => {
                const mine = resolveForUser(rsvps, e.event_id, "-", CURRENT_USER_ID);
                const cancelled = e.status === "cancelled";

                return (
                  <Pressable
                    key={e.event_id}
                    onPress={() =>
                      router.push({
                        pathname: "/calendar/[calendarId]/event/[eventId]",
                        params: {
                          calendarId: e.calendar_id,
                          eventId: e.event_id,
                          from: "calendar",
                        },
                      })
                    }
                    accessibilityRole="button"
                    style={{
                      padding: space.md,
                      gap: 2,
                      borderRadius: radius.sm,
                      borderWidth: 1,
                      borderColor: t.color.border,
                      // Your own answer, as a stripe rather than three buttons:
                      // sideways is a view for reading the shape of the trip,
                      // and controls at this size are mis-tapped more than used.
                      borderLeftWidth: 4,
                      borderLeftColor: cancelled
                        ? t.color.danger
                        : tone(mine.status as RsvpStatus | null),
                      backgroundColor: t.color.surface,
                      opacity: cancelled ? 0.65 : 1,
                    }}
                  >
                    <Text style={{ ...type.caption, color: t.color.textMuted }}>
                      {cancelled
                        ? "Called off"
                        : formatEventTime({
                            startUtc: e.start_utc,
                            endUtc: e.end_utc ?? undefined,
                            tz: e.tz,
                            localWall: e.local_wall,
                            precision: e.precision,
                          })}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={{
                        ...type.body,
                        color: t.color.text,
                        textDecorationLine: cancelled ? "line-through" : "none",
                      }}
                    >
                      {e.title}
                    </Text>
                    {e.location_name ? (
                      <Text
                        numberOfLines={1}
                        style={{ ...type.caption, color: t.color.textMuted }}
                      >
                        {e.location_name}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        );
      })}
    </ScrollView>
  );
}

const weekday = (iso: string): string =>
  new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });

const dayAndMonth = (iso: string): string =>
  new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
