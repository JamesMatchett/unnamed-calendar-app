import { Stack } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getDb } from "@/db/client";
import { useTheme } from "@/theme";

export default function RootLayout() {
  const t = useTheme();

  // Opening the database also creates the schema and seeds fixtures. It is
  // synchronous and fast, and doing it here means no screen ever has to consider
  // the possibility of an unopened database.
  useEffect(() => {
    getDb();
    // Portrait everywhere by default. The day screen unlocks rotation for
    // itself and re-locks on the way out, so landscape is an affordance on one
    // screen rather than something every screen must be designed for.
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  return (
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
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="people" options={{ presentation: "modal" }} />
        <Stack.Screen name="activity" options={{ presentation: "modal" }} />
        <Stack.Screen name="friends" options={{ presentation: "modal" }} />
        <Stack.Screen name="calendar/new" options={{ presentation: "modal" }} />
        <Stack.Screen
          name="calendar/[calendarId]/event/new"
          options={{ presentation: "modal" }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
