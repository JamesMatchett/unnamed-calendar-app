import { Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { ToggleRow } from "@/components/form";
import { getBoolPref, setBoolPref } from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

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

  return (
    <>
      <Stack.Screen options={{ title: "Settings", presentation: "modal" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
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
