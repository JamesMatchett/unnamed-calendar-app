import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { Alert, ScrollView, Text, View } from "react-native";

import { RowButton, Segmented, ToggleRow } from "@/components/form";
import { Group, Muted } from "@/components/ui";
import { LOCAL_ONLY } from "@/config";
import {
  clearAllData,
  examplesLoaded,
  getAppearance,
  getAuthProvider,
  getBoolPref,
  loadExampleData,
  replayOnboarding,
  setAppearance,
  setBoolPref,
} from "@/db/repo";
import { buildLabel, sendFeedback } from "@/lib/feedback";
import { useQuery } from "@/lib/useQuery";
import type { Appearance } from "@/theme";
import { APPEARANCES, radius, space, type, useTheme } from "@/theme";

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
  const examples = useQuery("examples", () => examplesLoaded());
  const provider = useQuery("auth:provider", () => getAuthProvider());

  return (
    <>
      <Stack.Screen options={{ title: "Settings", presentation: "modal" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        {LOCAL_ONLY ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              padding: space.lg,
              borderRadius: radius.md,
              backgroundColor: t.color.accentSoft,
            }}
          >
            <Ionicons name="phone-portrait-outline" size={20} color={t.color.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.label, color: t.color.text }}>
                This alpha keeps everything on this phone
              </Text>
              <Text style={{ ...type.caption, color: t.color.textMuted }}>
                Nothing syncs yet. Other people can't see what you add, and a
                reinstall starts fresh.
              </Text>
            </View>
          </View>
        ) : null}

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

        {/* Example data is a choice (alpha). A tester starts with their own
            empty calendar and can pull the examples in to see what a full
            app looks like, then clear them again to test for real. */}
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Example data
          </Text>
          <Group>
            <RowButton
              bare
              label="Load example calendars"
              value={examples ? "Loaded" : ""}
              onPress={
                examples
                  ? () => {}
                  : () =>
                      Alert.alert(
                        "Load the examples?",
                        "Adds a trip to Lisbon, a London calendar, a few friends and a week of plans, so you can see the app full. Your own calendars are untouched.",
                        [
                          { text: "Cancel", style: "cancel" },
                          { text: "Load", onPress: () => loadExampleData() },
                        ],
                      )
              }
            />
            <RowButton
              bare
              label="Clear everything"
              value=""
              onPress={() =>
                Alert.alert(
                  "Clear everything?",
                  "Every calendar, event, friend and answer on this phone goes, including your own. Your name and settings stay. This can't be undone.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Clear",
                      style: "destructive",
                      onPress: () => clearAllData(),
                    },
                  ],
                )
              }
            />
          </Group>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            About this build
          </Text>
          <Group>
            <RowButton
              bare
              label="Send feedback"
              value=""
              onPress={() => void sendFeedback()}
            />
            <RowButton bare label="Version" value={buildLabel()} onPress={() => {}} />
            <RowButton
              bare
              label="Show the welcome again"
              value={provider ? `Signed in with ${provider}` : ""}
              onPress={() =>
                Alert.alert(
                  "Show the welcome again?",
                  "Replays the first run: the tour, how you sign in, your name and the light or dark choice. Your calendars are untouched.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Show it", onPress: () => replayOnboarding() },
                  ],
                )
              }
            />
          </Group>
          <Muted>
            Something odd, something missing, something you liked: all useful.
          </Muted>
        </View>
      </ScrollView>
    </>
  );
}
