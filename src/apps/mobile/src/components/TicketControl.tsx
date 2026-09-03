import { Ionicons } from "@expo/vector-icons";
import type { TicketStatus } from "@calder/core";
import { Pressable, Text, View } from "react-native";

import { radius, space, type, useTheme } from "@/theme";

const OPTIONS: {
  value: TicketStatus;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "have", label: "Got one", icon: "checkmark-circle-outline" },
  { value: "looking", label: "Looking", icon: "search-outline" },
  { value: "none", label: "Not yet", icon: "ellipse-outline" },
];

/**
 * Where someone stands on getting in.
 *
 * Three states rather than a yes/no, because "looking" is the one other people
 * can act on: whoever ends up with a spare can see who needs it. A checkbox
 * cannot say that.
 *
 * Tapping the current answer clears it, since "I have not said" is a real state
 * and there should be a way back to it.
 */
export function TicketControl({
  value,
  onChange,
}: {
  value: TicketStatus | null;
  onChange: (next: TicketStatus | null) => void;
}) {
  const t = useTheme();

  const colourFor = (v: TicketStatus) =>
    v === "have" ? t.color.going : v === "looking" ? t.color.maybe : t.color.textMuted;

  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      {OPTIONS.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(selected ? null : o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.xs,
              paddingVertical: space.md - 2,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: selected ? colourFor(o.value) : t.color.border,
              backgroundColor: selected ? colourFor(o.value) : "transparent",
            }}
          >
            <Ionicons
              name={o.icon}
              size={15}
              color={selected ? "#fff" : t.color.textMuted}
            />
            <Text
              style={{
                ...type.caption,
                fontWeight: selected ? "700" : "500",
                color: selected ? "#fff" : t.color.textMuted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
