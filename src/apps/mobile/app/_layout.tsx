import { Stack } from "expo-router";
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
      </Stack>
    </SafeAreaProvider>
  );
}
