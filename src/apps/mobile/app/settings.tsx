import { Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { Segmented, ToggleRow } from "@/components/form";
import { Muted } from "@/components/ui";
import { getAppearance, getBoolPref, setAppearance, setBoolPref } from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import type { Appearance } from "@/theme";
import { APPEARANCES, space, type, useTheme } from "@/theme";

/**
 * Display settings for this device.
 *
 * Nothing here syncs: these are preferences about how the app draws, not state
 * anyone else in a calendar can see. They live in the meta table so they survive
 * a restart without needing another store.
 */
export default function SettingsScreen() {
  const t = useTheme();

  const countdown = useQuery("pref:countdown", () =>
    getBoolPref("countdown", true),
  );
  // Null only until the first-run question is answered, and this screen cannot
  // be reached before that.
  const appearance = useQuery("pref:appearance", () => getAppearance());

  return (
    <>
      <Stack.Screen options={{ title: "Settings", presentation: "modal" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Appearance
          </Text>
          <Segmented
            value={appearance ?? "system"}
            onChange={(v) => setAppearance(v as Appearance)}
            options={APPEARANCES}
          />
          <Muted>
            {appearance === "light"
              ? "Always light, whatever your phone is set to."
              : appearance === "dark"
                ? "Always dark, whatever your phone is set to."
                : "Follows your phone, including its light and dark schedule."}
          </Muted>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Agenda
          </Text>

          <ToggleRow
            label="Show days until"
            hint="Puts a countdown beside each date, so you can see how soon something is without doing the maths."
            value={countdown}
            onChange={(next) => setBoolPref("countdown", next)}
          />
        </View>
      </ScrollView>
    </>
  );
}
