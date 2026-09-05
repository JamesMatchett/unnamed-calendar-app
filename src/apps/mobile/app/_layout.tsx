import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppearancePrompt } from "@/components/AppearancePrompt";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { IdentityPrompt } from "@/components/IdentityPrompt";
import { getDb } from "@/db/client";
import { getAppearance, identityComplete } from "@/db/repo";
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
  // asking it first means the appearance sheet appears over an app that is
  // already yours.
  const named = useQuery("identity", () => identityComplete());
  const systemDark = useColorScheme() === "dark";
  const [preview, setPreview] = useState<Appearance>("system");
  const t = themeFor(chosen ?? preview, systemDark);

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
      {!named ? <IdentityPrompt onDone={() => {}} /> : null}
      {named && chosen === null ? (
        <AppearancePrompt
          value={preview}
          onPreview={setPreview}
          // Answering writes the choice, which makes `chosen` non-null and
          // takes the sheet away; nothing else to do here.
          onDone={() => {}}
        />
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
