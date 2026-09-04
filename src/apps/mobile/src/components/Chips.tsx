import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { radius, space, type, useTheme } from "@/theme";

export interface Chip {
  key: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  /** Present when the value can be dropped rather than only changed. */
  onClear?: () => void;
}

/**
 * What the parser understood, shown as small editable chips.
 *
 * The natural-language box used to sit above a second set of fields holding the
 * same values, which meant two places to type a name and no way to tell which
 * one counted. Chips replace that: they say what was read out of the sentence,
 * they are tappable to correct, and they take a fraction of the height a
 * parallel form did.
 *
 * Nothing here is authoritative — it reports what the parse decided, and every
 * chip is a way to overrule it.
 */
export function Chips({ chips }: { chips: readonly Chip[] }) {
  const t = useTheme();
  if (chips.length === 0) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: space.xs,
        alignItems: "center",
      }}
    >
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          onPress={chip.onPress}
          disabled={!chip.onPress}
          accessibilityRole="button"
          accessibilityLabel={`${chip.label}${chip.onPress ? ", tap to change" : ""}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingLeft: space.md,
            paddingRight: chip.onClear ? space.xs : space.md,
            paddingVertical: 5,
            borderRadius: radius.pill,
            backgroundColor: t.color.surfaceAlt,
          }}
        >
          {chip.icon ? (
            <Ionicons name={chip.icon} size={12} color={t.color.textMuted} />
          ) : null}
          <Text style={{ ...type.caption, color: t.color.text }}>{chip.label}</Text>

          {chip.onClear ? (
            <Pressable
              onPress={chip.onClear}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${chip.label}`}
              style={{ paddingHorizontal: 3 }}
            >
              <Ionicons name="close" size={12} color={t.color.textMuted} />
            </Pressable>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}
