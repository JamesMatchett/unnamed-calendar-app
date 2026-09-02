import { Ionicons } from "@expo/vector-icons";
import { addDays, todayIn } from "@uca/core";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { radius, space, type, useTheme } from "@/theme";

/**
 * A month grid where the calendar's own dates are emphasised and everything else
 * is dimmed but still selectable.
 *
 * The native date picker cannot express this: it offers minimum and maximum
 * dates, which *prevent* selection. That is the wrong rule here. People fly in
 * two days early or stay on for the weekend, and refusing to record it would
 * make the availability feature lie about who is around.
 *
 * So the range is presented as guidance rather than a constraint.
 */

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export function TripDatePicker({
  value,
  rangeStart,
  rangeEnd,
  tz,
  onSelect,
}: {
  /** YYYY-MM-DD, or null when nothing is chosen yet. */
  value: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  tz: string;
  onSelect: (date: string) => void;
}) {
  const t = useTheme();
  const today = todayIn(tz);
  const [visible, setVisible] = useState(
    (value ?? rangeStart ?? today).slice(0, 7),
  );

  const weeks = useMemo(() => buildMonth(visible), [visible]);

  const inRange = (date: string) =>
    rangeStart !== null &&
    rangeEnd !== null &&
    date >= rangeStart &&
    date <= rangeEnd;

  const shiftMonth = (delta: number) => {
    const [y, m] = visible.split("-").map(Number);
    const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + delta, 1));
    setVisible(d.toISOString().slice(0, 7));
  };

  return (
    <View
      style={{
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: t.color.border,
        backgroundColor: t.color.surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={19} color={t.color.text} />
        </Pressable>
        <Text style={{ ...type.label, color: t.color.text }}>
          {new Date(`${visible}-01T12:00:00.000Z`).toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
          })}
        </Text>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={10} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={19} color={t.color.text} />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row" }}>
        {WEEKDAY_LABELS.map((d, i) => (
          <Text
            key={`${d}-${i}`}
            style={{
              ...type.caption,
              flex: 1,
              textAlign: "center",
              color: t.color.textMuted,
            }}
          >
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: "row" }}>
          {week.map((date, di) => {
            if (date === null) {
              return <View key={`blank-${di}`} style={{ flex: 1, height: 38 }} />;
            }

            const selected = date === value;
            const within = inRange(date);
            const isToday = date === today;

            return (
              <Pressable
                key={date}
                onPress={() => onSelect(date)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${date}${within ? "" : ", outside the calendar's dates"}`}
                style={{
                  flex: 1,
                  height: 38,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.sm,
                  backgroundColor: selected
                    ? t.color.accent
                    : within
                      ? t.color.accentSoft
                      : "transparent",
                }}
              >
                <Text
                  style={{
                    ...type.body,
                    fontSize: 15,
                    // Outside the range stays legible rather than disabled: it is
                    // a hint about the trip, not a rule about the person.
                    color: selected
                      ? "#fff"
                      : within
                        ? t.color.text
                        : t.color.textMuted,
                    fontWeight: selected || isToday ? "700" : "400",
                  }}
                >
                  {Number(date.slice(8))}
                </Text>
                {isToday && !selected ? (
                  <View
                    style={{
                      position: "absolute",
                      bottom: 4,
                      width: 3,
                      height: 3,
                      borderRadius: radius.pill,
                      backgroundColor: t.color.accent,
                    }}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}

      {rangeStart && rangeEnd ? (
        <Text style={{ ...type.caption, color: t.color.textMuted }}>
          Shaded days are the calendar's dates. You can still pick others if
          you're arriving early or staying on.
        </Text>
      ) : null}
    </View>
  );
}

/** Weeks of a month, Monday first, padded with nulls. */
function buildMonth(month: string): (string | null)[][] {
  const first = `${month}-01`;
  // getUTCDay is Sunday-first; shift so Monday is 0.
  const offset = (new Date(`${first}T12:00:00.000Z`).getUTCDay() + 6) % 7;

  const days: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let cursor = first; cursor.startsWith(month); cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  while (days.length % 7 !== 0) days.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}
