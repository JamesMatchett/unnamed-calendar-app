import type { RsvpStatus } from "@uca/core";
import { Pressable, Text, View } from "react-native";

import { radius, space, type, useTheme } from "@/theme";

const OPTIONS: { value: RsvpStatus; short: string; long: string }[] = [
  { value: "going", short: "Going", long: "Going" },
  { value: "maybe", short: "Maybe", long: "Maybe" },
  { value: "not_going", short: "Can't", long: "Can't go" },
];

/**
 * The highest-frequency interaction in the app by an order of magnitude, so it
 * is reachable in one tap straight from a row — never behind an event screen
 * (§3.5).
 *
 * It also cannot fail for data reasons: the RSVP key includes the user id, so
 * two people answering at once write different items (§4.4 pattern 5). That is
 * why no network state ever appears here, even offline.
 */
export function RsvpControl({
  value,
  onChange,
  compact = false,
}: {
  value: RsvpStatus | null;
  onChange: (next: RsvpStatus) => void;
  compact?: boolean;
}) {
  const t = useTheme();

  const colorFor = (s: RsvpStatus) =>
    s === "going" ? t.color.going : s === "maybe" ? t.color.maybe : t.color.notGoing;

  return (
    <View style={{ flexDirection: "row", gap: space.xs }}>
      {OPTIONS.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={o.long}
            hitSlop={6}
            style={{
              paddingHorizontal: compact ? space.sm : space.md,
              paddingVertical: compact ? 5 : space.sm,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: selected ? colorFor(o.value) : t.color.border,
              backgroundColor: selected ? colorFor(o.value) : "transparent",
            }}
          >
            <Text
              style={{
                ...type.caption,
                fontWeight: selected ? "700" : "500",
                color: selected ? "#fff" : t.color.textMuted,
              }}
            >
              {compact ? o.short : o.long}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
