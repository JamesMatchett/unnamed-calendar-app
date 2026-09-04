import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, Text, View } from "react-native";

import { setAppearance } from "@/db/repo";
import type { Appearance } from "@/theme";
import { radius, space, type, useTheme } from "@/theme";

const CHOICES: {
  value: Appearance;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    value: "system",
    label: "Match my phone",
    detail: "Follows your phone's own light and dark setting.",
    icon: "phone-portrait-outline",
  },
  {
    value: "light",
    label: "Always light",
    detail: "",
    icon: "sunny-outline",
  },
  {
    value: "dark",
    label: "Always dark",
    detail: "",
    icon: "moon-outline",
  },
];

/**
 * Asked once, on the first open.
 *
 * Buried in settings, a dark mode is found by the people who go looking, which
 * is not the same set as the people who want it — and a calendar gets opened in
 * a dark venue as often as in daylight. One question at the start costs a tap
 * and settles it.
 *
 * "Match my phone" leads and is the default, because it is the only answer that
 * keeps being right when they change their mind at the OS level. The app
 * re-themes underneath as each option is touched rather than after the sheet
 * closes: the choice is about how it looks, so the honest preview is the app
 * itself.
 */
export function AppearancePrompt({
  value,
  onPreview,
  onDone,
}: {
  /** The option currently being previewed. */
  value: Appearance;
  onPreview: (next: Appearance) => void;
  onDone: () => void;
}) {
  const t = useTheme();

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onDone}>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0,0,0,0.4)",
        }}
      >
        <View
          style={{
            backgroundColor: t.color.bg,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: space.lg,
            paddingBottom: space.xxl,
            gap: space.md,
          }}
        >
          <Text style={{ ...type.heading, color: t.color.text }}>
            Light or dark?
          </Text>
          <Text style={{ ...type.caption, color: t.color.textMuted }}>
            Tap one to see it. You can change this any time in settings.
          </Text>

          <View style={{ gap: space.sm, paddingTop: space.xs }}>
            {CHOICES.map((choice) => {
              const selected = choice.value === value;
              return (
                <Pressable
                  key={choice.value}
                  onPress={() => onPreview(choice.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    padding: space.lg,
                    borderRadius: radius.md,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? t.color.accent : t.color.border,
                    backgroundColor: selected ? t.color.accentSoft : t.color.surface,
                  }}
                >
                  <Ionicons
                    name={choice.icon}
                    size={20}
                    color={selected ? t.color.accent : t.color.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        ...type.body,
                        fontWeight: selected ? "600" : "400",
                        color: selected ? t.color.accent : t.color.text,
                      }}
                    >
                      {choice.label}
                    </Text>
                    {choice.detail ? (
                      <Text style={{ ...type.caption, color: t.color.textMuted }}>
                        {choice.detail}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark" size={18} color={t.color.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => {
              // Whatever is being previewed is the answer, including the
              // default nobody touched: there is no way to leave this sheet
              // without having decided something.
              setAppearance(value);
              onDone();
            }}
            accessibilityRole="button"
            style={{
              alignItems: "center",
              paddingVertical: space.lg,
              borderRadius: radius.md,
              backgroundColor: t.color.accentFill,
            }}
          >
            <Text style={{ ...type.label, fontSize: 16, color: t.color.onAccent }}>
              Use this
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
