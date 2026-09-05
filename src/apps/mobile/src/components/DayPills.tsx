import { Pressable, ScrollView, Text, View } from "react-native";

import { formatDayPill } from "@/lib/format";
import { radius, space, type, useTheme } from "@/theme";

/**
 * The day selector. A horizontal strip suits a BOUNDED calendar, where the whole
 * trip fits on screen; continuous calendars get sticky headers and a jump-to-date
 * instead, because the range has no end (§3.5).
 */
export function DayPills({
  days,
  tz,
  selected,
  counts,
  onSelect,
}: {
  days: readonly string[];
  tz: string;
  selected: string | null;
  counts: Readonly<Record<string, number>>;
  onSelect: (day: string) => void;
}) {
  const t = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg }}
    >
      {days.map((d, i) => {
        const isSelected = d === selected;
        // A trip can run 28 Sep to 3 Oct, and "30, 1, 2" says nothing about
        // which month it is. Mark the change rather than repeating the month on
        // every pill, which would crowd the number that people actually scan.
        const startsMonth = i === 0 || d.slice(0, 7) !== days[i - 1]?.slice(0, 7);
        const label = formatDayPill(`${d}T12:00:00.000Z`, tz);
        const count = counts[d] ?? 0;

        return (
          <View key={d} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            {startsMonth ? (
              <Text
                style={{
                  ...type.caption,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  color: t.color.textMuted,
                  // Only worth the space when the strip actually crosses a
                  // month; the first label doubles as context for the rest.
                  marginLeft: i === 0 ? 0 : space.xs,
                }}
              >
                {new Date(`${d}T12:00:00.000Z`)
                  .toLocaleDateString("en-GB", { month: "short", timeZone: tz })
                  .toUpperCase()}
              </Text>
            ) : null}

            <Pressable
              onPress={() => onSelect(d)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={{
                width: 52,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                alignItems: "center",
                backgroundColor: isSelected ? t.color.accentFill : t.color.surface,
                borderWidth: 1,
                borderColor: isSelected ? t.color.accent : t.color.border,
              }}
            >
              <Text
                style={{
                  ...type.caption,
                  color: isSelected ? t.color.onAccent : t.color.textMuted,
                }}
              >
                {label.top}
              </Text>
              <Text
                style={{
                  ...type.label,
                  fontSize: 17,
                  color: isSelected ? t.color.onAccent : t.color.text,
                }}
              >
                {label.bottom}
              </Text>
              <View
                style={{
                  height: 4,
                  width: 4,
                  borderRadius: radius.pill,
                  marginTop: 4,
                  backgroundColor:
                    count > 0
                      ? isSelected
                        ? "#fff"
                        : t.color.accent
                      : "transparent",
                }}
              />
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}
