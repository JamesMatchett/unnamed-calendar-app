import { Ionicons } from "@expo/vector-icons";
import type { TravelMode } from "@uca/core";
import { TRAVEL_MODES } from "@uca/core";
import { Pressable, Text, View } from "react-native";

import { radius, space, type, useTheme } from "@/theme";

/**
 * How people get there. Purely presentational, but a plane icon against "Dave
 * arrives @ 18:30" reads as wrong when the trip is a two-hour drive to Cornwall,
 * and small wrongnesses are what make an app feel generic.
 */
export const TRAVEL_ICON: Record<TravelMode, keyof typeof Ionicons.glyphMap> = {
  plane: "airplane-outline",
  train: "train-outline",
  car: "car-outline",
  boat: "boat-outline",
  walk: "walk-outline",
};

export const TRAVEL_LABEL: Record<TravelMode, string> = {
  plane: "Flying",
  train: "Train",
  car: "Driving",
  boat: "Boat",
  walk: "On foot",
};

export function TravelModePicker({
  value,
  onChange,
}: {
  value: TravelMode;
  onChange: (next: TravelMode) => void;
}) {
  const t = useTheme();

  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      {TRAVEL_MODES.map((mode) => {
        const selected = mode === value;
        return (
          <Pressable
            key={mode}
            onPress={() => onChange(mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={TRAVEL_LABEL[mode]}
            style={{
              flex: 1,
              alignItems: "center",
              gap: 3,
              paddingVertical: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: selected ? t.color.accent : t.color.border,
              backgroundColor: selected ? t.color.accentSoft : t.color.surface,
            }}
          >
            <Ionicons
              name={TRAVEL_ICON[mode]}
              size={20}
              color={selected ? t.color.accent : t.color.textMuted}
            />
            <Text
              style={{
                ...type.caption,
                fontSize: 11,
                color: selected ? t.color.accent : t.color.textMuted,
              }}
            >
              {TRAVEL_LABEL[mode]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
