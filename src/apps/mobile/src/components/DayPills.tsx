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
      {days.map((d) => {
        const isSelected = d === selected;
        const label = formatDayPill(`${d}T12:00:00.000Z`, tz);
        const count = counts[d] ?? 0;

        return (
          <Pressable
            key={d}
            onPress={() => onSelect(d)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            style={{
              width: 52,
              paddingVertical: space.sm,
              borderRadius: radius.md,
              alignItems: "center",
              backgroundColor: isSelected ? t.color.accent : t.color.surface,
              borderWidth: 1,
              borderColor: isSelected ? t.color.accent : t.color.border,
            }}
          >
            <Text
              style={{
                ...type.caption,
                color: isSelected ? "#fff" : t.color.textMuted,
              }}
            >
              {label.top}
            </Text>
            <Text
              style={{
                ...type.label,
                fontSize: 17,
                color: isSelected ? "#fff" : t.color.text,
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
        );
      })}
    </ScrollView>
  );
}
