import { Tabs } from "expo-router";
import { Text, View } from "react-native";

import {
  ActivityButton,
  PeopleButton,
  ProfileButton,
  SyncButton,
} from "@/components/HeaderButtons";
import { useTheme } from "@/theme";

/**
 * Two tabs, not three. Discover is designed (§3.5) but hidden until the
 * catalogue ships — a visible dead tab makes the app feel unfinished exactly
 * when it can least afford to.
 *
 * Agenda is home by default, and is user-selectable via `homeTab` on the
 * profile (decision 18).
 */
export default function TabsLayout() {
  const t = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.color.bg },
        headerTintColor: t.color.text,
        headerShadowVisible: false,
        tabBarActiveTintColor: t.color.accent,
        tabBarInactiveTintColor: t.color.textMuted,
        tabBarStyle: {
          backgroundColor: t.color.surface,
          borderTopColor: t.color.border,
        },
        sceneStyle: { backgroundColor: t.color.bg },
        headerLeft: () => (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ProfileButton />
            <PeopleButton />
          </View>
        ),
        headerRight: () => (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <SyncButton />
            <ActivityButton />
          </View>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Agenda",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◷</Text>,
        }}
      />
      <Tabs.Screen
        name="calendars"
        options={{
          title: "Calendars",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>▦</Text>,
        }}
      />
    </Tabs>
  );
}
