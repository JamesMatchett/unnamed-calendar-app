import { layoutDay, minutesInDay } from "@uca/core";
import { Link } from "expo-router";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import type { EventRow, MemberRow, RsvpRow } from "@/db/repo";
import { resolveForUser } from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { radius, space, type, useTheme } from "@/theme";

const HOUR_HEIGHT = 56;
const GUTTER = 52;

/**
 * The landscape day view: an hour grid where overlapping events sit side by
 * side, so a clash is visible rather than inferred.
 *
 * This is the one place a grid earns its keep. §3.5 argues against a month grid
 * on mobile because it is low density and hard to read on a phone — but a single
 * day in landscape has exactly the opposite property: plenty of width, one axis,
 * and a question ("do these two things collide?") that a list genuinely cannot
 * answer at a glance.
 */
export function DayTimeline({
  date,
  tz,
  events,
  members,
  rsvps,
}: {
  date: string;
  tz: string;
  events: readonly EventRow[];
  members: readonly MemberRow[];
  rsvps: readonly RsvpRow[];
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  // Events without a real time cannot be positioned on an axis. They get a strip
  // at the top rather than being dropped or pinned to midnight, which would be a
  // lie about when they happen (§4.3, `precision`).
  const untimed = events.filter((e) => e.precision !== "datetime");
  const timed = events.filter((e) => e.precision === "datetime");

  const laid = layoutDay(
    timed.map((e) => {
      const startMin = minutesInDay(e.start_utc, tz);
      const endMin = e.end_utc ? minutesInDay(e.end_utc, tz) : startMin + 60;
      return {
        item: e,
        startMin,
        // An event running past midnight clamps to the end of the day rather
        // than wrapping to the top.
        endMin: endMin <= startMin ? 24 * 60 : endMin,
      };
    }),
  );

  const firstMin = laid.length > 0 ? Math.min(...laid.map((l) => l.startMin)) : 8 * 60;

  useEffect(() => {
    const y = Math.max(0, ((firstMin - 60) / 60) * HOUR_HEIGHT);
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 0);
    return () => clearTimeout(id);
  }, [firstMin]);

  const laneWidth = width - GUTTER - space.lg * 2;
  const nowMin = nowMinutesIfToday(date, tz);

  return (
    <View style={{ flex: 1 }}>
      {untimed.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            gap: space.sm,
            paddingHorizontal: space.lg,
            paddingVertical: space.sm,
            borderBottomWidth: 1,
            borderBottomColor: t.color.border,
          }}
        >
          {untimed.map((e) => (
            <View
              key={e.event_id}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: space.xs,
                borderRadius: radius.sm,
                backgroundColor: t.color.surfaceAlt,
              }}
            >
              <Text style={{ ...type.caption, color: t.color.text }}>
                {e.title} · {e.precision === "tbc" ? "TBC" : "All day"}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: space.xl }}>
        <View style={{ height: 24 * HOUR_HEIGHT, paddingHorizontal: space.lg }}>
          {Array.from({ length: 24 }, (_, h) => (
            <View
              key={h}
              style={{
                position: "absolute",
                top: h * HOUR_HEIGHT,
                left: space.lg,
                right: space.lg,
                flexDirection: "row",
                alignItems: "flex-start",
              }}
            >
              <Text
                style={{
                  ...type.caption,
                  color: t.color.textMuted,
                  width: GUTTER - space.sm,
                  textAlign: "right",
                  marginTop: -7,
                }}
              >
                {String(h).padStart(2, "0")}:00
              </Text>
              <View
                style={{
                  flex: 1,
                  height: 1,
                  marginLeft: space.sm,
                  backgroundColor: t.color.border,
                }}
              />
            </View>
          ))}

          {nowMin !== null ? (
            <View
              style={{
                position: "absolute",
                top: (nowMin / 60) * HOUR_HEIGHT,
                left: space.lg + GUTTER,
                right: space.lg,
                height: 2,
                backgroundColor: t.color.danger,
              }}
            />
          ) : null}

          {laid.map(({ item, startMin, endMin, left, width: w }) => {
            const going = members.filter(
              (m) =>
                resolveForUser(rsvps, item.event_id, "-", m.user_id).status === "going",
            ).length;
            const mine = resolveForUser(rsvps, item.event_id, "-", CURRENT_USER_ID);
            const cancelled = item.status === "cancelled";

            return (
              <Link
                key={item.event_id}
                href={{
                  pathname: "/calendar/[calendarId]/event/[eventId]",
                  params: { calendarId: item.calendar_id, eventId: item.event_id },
                }}
                asChild
              >
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`${item.title}, ${going} going`}
                  style={{
                    position: "absolute",
                    top: (startMin / 60) * HOUR_HEIGHT,
                    height: ((endMin - startMin) / 60) * HOUR_HEIGHT - 2,
                    left: space.lg + GUTTER + left * laneWidth + 2,
                    width: w * laneWidth - 4,
                    borderRadius: radius.sm,
                    padding: space.sm,
                    overflow: "hidden",
                    backgroundColor:
                      mine.status === "going" ? t.color.accent : t.color.accentSoft,
                    borderLeftWidth: 3,
                    borderLeftColor:
                      mine.status === "going" ? t.color.going : t.color.accent,
                    opacity: cancelled ? 0.45 : 1,
                  }}
                >
                  <Text
                    numberOfLines={2}
                    style={{
                      ...type.caption,
                      fontWeight: "600",
                      color: mine.status === "going" ? "#fff" : t.color.text,
                      textDecorationLine: cancelled ? "line-through" : "none",
                    }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      ...type.caption,
                      fontSize: 11,
                      color: mine.status === "going" ? "#fff" : t.color.textMuted,
                    }}
                  >
                    {going > 0 ? `${going} going` : "No replies"}
                    {item.location_name ? ` · ${item.location_name}` : ""}
                  </Text>
                </Pressable>
              </Link>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/** The now-line only makes sense when the day being shown is actually today. */
function nowMinutesIfToday(date: string, tz: string): number | null {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(new Date());
  if (today !== date) return null;
  return minutesInDay(new Date().toISOString(), tz);
}
