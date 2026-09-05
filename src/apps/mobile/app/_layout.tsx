import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Onboarding } from "@/components/Onboarding";
import { getDb } from "@/db/client";
import { getAppearance, identityComplete } from "@/db/repo";
import { useAutoSync } from "@/lib/useAutoSync";
import { useNotifier } from "@/lib/useNotifier";
import { useQuery } from "@/lib/useQuery";
import type { Appearance } from "@/theme";
import { ThemeProvider, themeFor } from "@/theme";

export default function RootLayout() {
  /**
   * Light or dark, decided once here and handed down.
   *
   * No stored choice means the person has never been asked, which is a
   * different thing from having chosen to follow the phone: the first is why
   * the prompt appears, the second is one of its answers. Until they answer,
   * the app follows the phone, so the question is asked over an app that
   * already looks right rather than over a white flash.
   */
  const chosen = useQuery("pref:appearance", () => getAppearance());
  // Who you are comes before how it looks: the name goes on everything, and
  // asking it first means the appearance step is chosen against an app that is
  // already theirs. Either being unset means the first run has not finished.
  const named = useQuery("identity", () => identityComplete());
  const systemDark = useColorScheme() === "dark";
  const [preview, setPreview] = useState<Appearance>("system");
  const t = themeFor(chosen ?? preview, systemDark);

  // Automatic sync lives at the root rather than on the sync screen, because
  // the moment worth syncing is just after an event is added, and nobody adds
  // an event from the sync screen. It does nothing at all unless the preference
  // is on and calendar access has already been granted.
  useAutoSync();
  // Reminders are a real schedule held by the phone, so this has to run
  // wherever the person is, not on the screen where the preference lives.
  useNotifier();

  // Opening the database also creates the schema and seeds fixtures. It is
  // synchronous and fast, and doing it here means no screen ever has to consider
  // the possibility of an unopened database.
  useEffect(() => {
    getDb();
    // Portrait is the app-wide default, set in app.json rather than locked from
    // here. A lock in this effect ran AFTER the screens' own effects — children
    // mount first — so it silently undid every unlockAsync a screen had just
    // asked for, and rotation only worked once a screen re-ran its effect. The
    // screens that want landscape unlock for themselves and re-lock on the way
    // out.
  }, []);

  return (
    <ErrorBoundary>
    <ThemeProvider value={t}>
    <SafeAreaProvider>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.color.bg },
          headerTintColor: t.color.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.color.bg },
        }}
      >
        {/* The tab group has no header of its own, but its title is what the
            back button on any pushed screen reads. Without one it falls back to
            the route name and says "(tabs)". */}
        <Stack.Screen
          name="(tabs)"
          options={{ headerShown: false, title: "Home" }}
        />
        <Stack.Screen name="people" options={{ presentation: "modal" }} />
        <Stack.Screen name="profile" options={{ presentation: "modal" }} />
        <Stack.Screen name="settings" options={{ presentation: "modal" }} />
        <Stack.Screen name="notifications" options={{ presentation: "modal" }} />
        <Stack.Screen name="suggestion" options={{ presentation: "modal" }} />
        <Stack.Screen name="activity" options={{ presentation: "modal" }} />
        {/* Only the entry screen is modal. Choosing a direction pushes an
            ordinary screen over it, which keeps a back button rather than a
            second dismiss gesture: the list of what is about to be copied is
            somewhere you go INTO, and swiping it away by accident on the way to
            reading it would lose the selection. */}
        <Stack.Screen name="sync/index" options={{ presentation: "modal" }} />
        {/* Every route is registered here, with its title and its presentation,
            and NOT via <Stack.Screen> inside the screen. Two separate things go
            wrong otherwise, and the second is much worse than the first.

            An unregistered route keeps the file path as its header title, which
            is what "calendar/[calendarId]/settings" across the top used to be.

            And presentation cannot be changed once a screen is mounted: it
            decides which container the navigator builds. Setting it from inside
            means the screen mounts as a card and then asks to be a modal, and
            the navigator obliges by creating the scene again — which is what
            "the tickets toggle opens a second copy of the event" was. The
            trigger looked like the toggle only because that is where somebody
            happened to tap; any re-render would do it.

            tools/check-routes.mjs enforces both halves. */}
        <Stack.Screen
          name="calendar/new"
          options={{ title: "New calendar", presentation: "modal" }}
        />
        <Stack.Screen
          name="calendar/[calendarId]/event/new"
          options={{ title: "Add an event", presentation: "modal" }}
        />
        <Stack.Screen
          name="calendar/[calendarId]/event/edit/[eventId]"
          options={{ title: "Edit event", presentation: "modal" }}
        />
        <Stack.Screen
          name="calendar/[calendarId]/event/slot/[eventId]"
          options={{ title: "Suggest a time", presentation: "modal" }}
        />
        <Stack.Screen
          name="calendar/[calendarId]/invite"
          options={{ title: "Invite people", presentation: "modal" }}
        />
        {/* Pushed rather than modal, deliberately: the calendar stays underneath
            with a back button to it. The screen file used to ask for a modal
            from the inside, which never took effect here and only risked the
            remount above. */}
        <Stack.Screen
          name="calendar/[calendarId]/settings"
          options={{ title: "Calendar settings" }}
        />
        <Stack.Screen name="connect" options={{ presentation: "modal" }} />
        {/* The title is set from inside, from the person's name. A title is an
            ordinary option and can change after mount; presentation cannot,
            which is why only the second one lives here. */}
        <Stack.Screen
          name="person/[userId]/index"
          options={{ presentation: "modal" }}
        />
        {/* Where universal links land: calandder.com/join/<token> (§7.1) and
            calandder.com/add/<handle> (§7.3). */}
        <Stack.Screen name="join/[token]" options={{ presentation: "modal" }} />
        <Stack.Screen name="add/[handle]" options={{ presentation: "modal" }} />
      </Stack>
      {/* The first run, as one flow. It ends by writing the appearance, which
          makes `chosen` non-null and takes it away; nothing else to do here.

          AFTER the Stack, because it is an absolutely positioned overlay now
          rather than a Modal, and paint order is what puts it on top. See the
          comment in Onboarding for why it stopped being a Modal. */}
      {!named || chosen === null ? (
        <Onboarding appearance={preview} onPreviewAppearance={setPreview} />
      ) : null}
    </SafeAreaProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}
