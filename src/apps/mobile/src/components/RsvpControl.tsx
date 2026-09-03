import type { RsvpStatus } from "@calder/core";
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
  fill = false,
  cancelled = false,
}: {
  value: RsvpStatus | null;
  /** `null` when the current answer is tapped again, clearing it. */
  onChange: (next: RsvpStatus | null) => void;
  compact?: boolean;
  /** Share the available width equally, so three options always fit. */
  fill?: boolean;
  /**
   * The event is called off, so the three options are struck through and stop
   * responding. Hiding them instead would be worse: an answer someone already
   * gave is part of the history of the thing, and a card that silently loses
   * its controls reads as a rendering fault rather than a cancellation.
   */
  cancelled?: boolean;
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
            // Tapping the current answer clears it. "Haven't replied" is a real
            // state (§3.5) and there has to be a way back to it: people change
            // their minds, and being stuck on "Can't" because it was a mistap is
            // worse than having no answer.
            onPress={() => onChange(selected ? null : o.value)}
            disabled={cancelled}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: cancelled }}
            accessibilityLabel={
              cancelled ? `${o.long}, unavailable, event cancelled` : o.long
            }
            hitSlop={6}
            style={{
              flex: fill ? 1 : undefined,
              alignItems: fill ? "center" : undefined,
              paddingHorizontal: compact ? space.sm : space.md,
              paddingVertical: compact ? 5 : space.sm,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: cancelled
                ? t.color.border
                : selected
                  ? colorFor(o.value)
                  : t.color.border,
              // A struck-through button on a filled background is unreadable, so
              // a cancelled event drops the fill and keeps only the outline.
              backgroundColor:
                selected && !cancelled ? colorFor(o.value) : "transparent",
              opacity: cancelled ? 0.65 : 1,
            }}
          >
            <Text
              style={{
                ...type.caption,
                fontWeight: selected ? "700" : "500",
                textDecorationLine: cancelled ? "line-through" : "none",
                color: cancelled
                  ? selected
                    ? colorFor(o.value)
                    : t.color.textMuted
                  : selected
                    ? "#fff"
                    : t.color.textMuted,
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
