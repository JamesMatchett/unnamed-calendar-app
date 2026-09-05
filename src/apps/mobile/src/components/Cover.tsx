import { Ionicons } from "@expo/vector-icons";
import { Image, Text, View } from "react-native";

import { coverSource } from "@/lib/images";
import { radius, space, type, useTheme } from "@/theme";

/**
 * A calendar's cover.
 *
 * Sits above the title rather than behind it: text over an arbitrary photograph
 * needs a scrim and still fails on some images, and a calendar's name is the one
 * thing on the screen that must always be readable.
 */
export function Cover({
  value,
  height = 150,
  radiusSize = radius.md,
}: {
  value: string | null | undefined;
  height?: number;
  radiusSize?: number;
}) {
  const t = useTheme();
  const source = coverSource(value);
  if (!source) return null;

  return (
    <Image
      source={source}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
      style={{
        width: "100%",
        height,
        borderRadius: radiusSize,
        backgroundColor: t.color.surfaceAlt,
      }}
    />
  );
}

/** Shown where a cover would be, when there is not one yet. */
export function CoverPlaceholder({
  label,
  height = 150,
}: {
  label: string;
  height?: number;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        width: "100%",
        height,
        borderRadius: radius.md,
        backgroundColor: t.color.surfaceAlt,
        alignItems: "center",
        justifyContent: "center",
        gap: space.xs,
      }}
    >
      <Ionicons name="image-outline" size={22} color={t.color.textMuted} />
      <Text style={{ ...type.caption, color: t.color.textMuted }}>{label}</Text>
    </View>
  );
}
