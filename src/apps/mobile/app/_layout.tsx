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
      {/* The first run, as one flow. It ends by writing the appearance, which
          makes `chosen` non-null and takes it away; nothing else to do here. */}
      {!named || chosen === null ? (
        <Onboarding appearance={preview} onPreviewAppearance={setPreview} />
      ) : null}
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
        <Stack.Screen name="suggestion" options={{ presentation: "modal" }} />
        <Stack.Screen name="activity" options={{ presentation: "modal" }} />
        {/* Only the entry screen is modal. Choosing a direction pushes an
            ordinary screen over it, which keeps a back button rather than a
            second dismiss gesture: the list of what is about to be copied is
            somewhere you go INTO, and swiping it away by accident on the way to
            reading it would lose the selection. */}
        <Stack.Screen name="sync/index" options={{ presentation: "modal" }} />
        <Stack.Screen name="calendar/new" options={{ presentation: "modal" }} />
        <Stack.Screen
          name="calendar/[calendarId]/event/new"
          options={{ presentation: "modal" }}
        />
        <Stack.Screen
          name="calendar/[calendarId]/invite"
          options={{ presentation: "modal" }}
        />
        {/* Registered here, not only via <Stack.Screen> inside the screen:
            an unregistered route keeps the file path as its header title,
            which is what "calendar/[calendarId]/settings" across the top was. */}
        <Stack.Screen
          name="calendar/[calendarId]/settings"
          options={{ title: "Calendar settings" }}
        />
        {/* Where universal links land: calandder.com/join/<token> (§7.1). */}
        <Stack.Screen name="join/[token]" options={{ presentation: "modal" }} />
      </Stack>
    </SafeAreaProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}
