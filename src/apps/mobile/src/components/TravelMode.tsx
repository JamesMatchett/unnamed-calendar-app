import { Ionicons } from "@expo/vector-icons";
import type { TravelMode } from "@calder/core";
import { nextTravelSelection, TRAVEL_MODES } from "@calder/core";
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

/**
 * How you are getting there AND back, in one row of icons.
 *
 * Two separate pickers would be the obvious build and the wrong one: the
 * answer is the same mode both ways for almost everybody, so a second row of
 * five icons is a second decision asked of people who have already made it.
 * Instead each icon carries two edges — a green left edge for the way in, a red
 * right edge for the way out — and taps fill them in order:
 *
 *   tap plane, tap plane   → flying both ways (both edges on one icon)
 *   tap plane, tap car     → fly in, drive back
 *   tap again              → starts over, so a mistake costs one tap
 *
 * The edges are the same marks used everywhere else in the app for arriving
 * and leaving, so the row explains itself without a legend.
 */
export function TravelDirectionPicker({
  arrival,
  departure,
  onChange,
}: {
  arrival: TravelMode | null;
  /** Null means "the same way I came", which is the common case. */
  departure: TravelMode | null;
  onChange: (arrival: TravelMode, departure: TravelMode | null) => void;
}) {
  const t = useTheme();

  const press = (mode: TravelMode) => {
    const next = nextTravelSelection({ arrival, departure }, mode);
    onChange(next.arrival ?? mode, next.departure);
  };

  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      {TRAVEL_MODES.map((mode) => {
        const isIn = arrival === mode;
        const isOut = departure === mode || (departure === null && arrival === mode);
        const touched = isIn || departure === mode;

        return (
          <Pressable
            key={mode}
            onPress={() => press(mode)}
            accessibilityRole="button"
            accessibilityLabel={`${TRAVEL_LABEL[mode]}${
              isIn ? ", arriving" : ""
            }${isOut ? ", leaving" : ""}`}
            style={{
              flex: 1,
              alignItems: "center",
              gap: 3,
              paddingVertical: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: touched ? t.color.accent : t.color.border,
              // The two edges are the whole language of this control, so they
              // are thicker than the box they sit on.
              borderLeftWidth: isIn ? 4 : 1,
              borderLeftColor: isIn ? t.color.going : t.color.border,
              borderRightWidth: isOut ? 4 : 1,
              borderRightColor: isOut ? t.color.notGoing : t.color.border,
              backgroundColor: touched ? t.color.accentSoft : t.color.surface,
            }}
          >
            <Ionicons
              name={TRAVEL_ICON[mode]}
              size={20}
              color={touched ? t.color.accent : t.color.textMuted}
            />
            <Text
              style={{
                ...type.caption,
                fontSize: 11,
                color: touched ? t.color.accent : t.color.textMuted,
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
