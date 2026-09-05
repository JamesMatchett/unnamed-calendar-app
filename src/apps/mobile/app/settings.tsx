import type { NotifyPrefs } from "@calder/core";
import { NOTIFY_GROUPS } from "@calder/core";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";

import { RowButton, Segmented, ToggleRow } from "@/components/form";
import { Group, Muted } from "@/components/ui";
import { API_BASE, ENVIRONMENT, LOCAL_ONLY } from "@/config";
import {
  clearAllData,
  examplesLoaded,
  getAppearance,
  getAuthProvider,
  getNotifyPrefs,
  getBoolPref,
  loadExampleData,
  replayOnboarding,
  setAppearance,
  setBoolPref,
} from "@/db/repo";
import { health, me } from "@/lib/api";
import { providerLabel } from "@/lib/auth";
import { isFresh, loadSession } from "@/lib/session";
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
  const router = useRouter();

  const countdown = useQuery("pref:countdown", () =>
    getBoolPref("countdown", true),
  );
  // Null only until the first-run question is answered, and this screen cannot
  // be reached before that.
  const appearance = useQuery("pref:appearance", () => getAppearance());
  const examples = useQuery("examples", () => examplesLoaded());
  const provider = useQuery("auth:provider", () => getAuthProvider());
  const notify = useQuery("notify:prefs", () => getNotifyPrefs());
  const [server, setServer] = useState<string>(ENVIRONMENT);
  const [account, setAccount] = useState<string>("Tap to check");

  return (
    <>
      <Stack.Screen options={{ title: "Settings" }} />
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
            Notifications
          </Text>
          <Group>
            <RowButton
              bare
              label="Notifications and reminders"
              value={notifySummary(notify)}
              onPress={() => router.push("/notifications")}
            />
          </Group>
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
              label="Server"
              value={server}
              onPress={() => void checkServer(setServer)}
            />
            <RowButton
              bare
              label="Account"
              value={account}
              onPress={() => void checkAccount(setAccount)}
            />
            <RowButton
              bare
              label="Show the welcome again"
              value={provider ? `Signed in with ${providerLabel(provider)}` : ""}
              onPress={() =>
                Alert.alert(
                  "Show the welcome again?",
                  "Replays the first run: the tour, how you sign in, your name and the light or dark choice. Your calendars are untouched.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Show it",
                      // Replay, then leave: the first run is an overlay in
                      // the root view, so it mounts under this sheet and is
                      // revealed as it goes. See profile.tsx for why it is not
                      // a Modal any more.
                      onPress: () => {
                        replayOnboarding();
                        router.dismissAll();
                        router.replace("/");
                      },
                    },
                  ],
                )
              }
            />
          </Group>
          <Muted>
            Something odd, something missing, something you liked: all useful.
            Tap Server to check this phone can reach {API_BASE.replace("https://", "")}.
          </Muted>
        </View>
      </ScrollView>
    </>
  );
}

/**
 * Ask the API what it is, and put the answer in the row.
 *
 * The interesting result is not "reachable". It is WHICH environment answered:
 * a build pointed at the wrong one gets a perfectly healthy 200 from somewhere
 * it has no business talking to, and nothing else in the app would ever say so.
 * So the row disagrees loudly when the environment that answered is not the one
 * this build thinks it belongs to.
 *
 * Failures are named rather than collapsed into "unavailable", because a tester
 * reporting "no signal" and a tester reporting "timed out" are telling us about
 * two different problems, and only one of them is ours.
 */
async function checkServer(set: (value: string) => void): Promise<void> {
  set("checking...");
  const result = await health();

  if (!result.ok) {
    const { error } = result;
    set(
      error.kind === "offline"
        ? "no connection"
        : error.kind === "timeout"
          ? "no answer"
          : error.kind === "status"
            ? `error ${error.status}`
            : "bad response",
    );
    return;
  }

  const answered = result.value.environment;
  set(
    answered === ENVIRONMENT
      ? `${answered}, ${result.value.commit.slice(0, 7)}`
      : `WRONG: ${answered}`,
  );
}

/**
 * Ask the API who this phone is.
 *
 * The end of the whole chain in one tap: a token in the Keychain, accepted by
 * API Gateway's authoriser, carrying a ULID that the Pre Token Generation
 * trigger minted on first sign-in and wrote to the table. If this shows an id,
 * every piece between the phone and DynamoDB is working.
 *
 * The states are told apart on purpose. Never signed in, signed in but expired,
 * and signed in and rejected are three different problems, and "not signed in"
 * for all three is how a token bug gets reported as a login bug.
 */
async function checkAccount(set: (value: string) => void): Promise<void> {
  set("checking...");
  const session = await loadSession();

  if (session === null) {
    set("Not signed in");
    return;
  }
  if (!isFresh(session)) {
    // Refreshing is not wired up yet, so this is honest rather than hidden:
    // the session exists and has aged out.
    set("Session expired");
    return;
  }

  const result = await me(session.idToken);
  if (!result.ok) {
    const { error } = result;
    set(
      error.kind === "status" && error.status === 401
        ? "Token rejected"
        : error.kind === "offline"
          ? "no connection"
          : error.kind === "timeout"
            ? "no answer"
            : "error",
    );
    return;
  }

  // The first eight characters of a ULID are its timestamp, so this is enough
  // to tell two accounts apart and to see that it is stable across sign-ins.
  set(result.value.userId?.slice(0, 8) ?? "no id in token");
}

/**
 * One line for a screen with a dozen switches on it.
 *
 * "On" would be true and useless when every group is muted and no reminder is
 * set, which is a state somebody can reach without meaning to. The summary
 * names whichever half is off so the row is worth reading.
 */
function notifySummary(prefs: NotifyPrefs): string {
  if (!prefs.enabled) return "Off";
  const silent = prefs.muted.length === NOTIFY_GROUPS.length;
  if (silent && prefs.remindAt.length === 0) return "Nothing on";
  if (silent) return "Reminders only";
  if (prefs.remindAt.length === 0) return "No reminders";
  return "On";
}
