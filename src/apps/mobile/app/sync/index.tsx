import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";

import { RowButton } from "@/components/form";
import { Card, Group, Muted } from "@/components/ui";
import { calendarNames, getSyncPrefs, lastSyncAt, listDeviceLinks } from "@/db/repo";
import { useDeviceCalendars } from "@/lib/useDeviceCalendar";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Talking to the calendar app already on this phone (§5.7).
 *
 * The two directions are offered as two separate choices rather than one
 * "sync" button, because they are not the same decision and they do not carry
 * the same risk. Sending events out writes into a calendar that other apps,
 * and possibly other people, are looking at. Bringing events in only adds to
 * this app. Collapsing both behind one button would mean the safer of the two
 * could never be chosen on its own, and the riskier one would happen by
 * accident.
 *
 * Nothing on this screen runs anything. Every route from here ends on a screen
 * where you can see exactly what is about to be copied before you press the
 * button that copies it.
 */
export default function SyncScreen() {
  const t = useTheme();
  const router = useRouter();

  const { permission, calendars, pending } = useDeviceCalendars();
  const prefs = useQuery("sync:prefs", () => getSyncPrefs());
  const names = useQuery("calendar:names", () => calendarNames());
  const sentOut = useQuery("links:out", () => listDeviceLinks("out"));
  const broughtIn = useQuery("links:in", () => listDeviceLinks("in"));
  const last = useQuery("sync:last", () => lastSyncAt());

  const target = prefs.targetCalendarId
    ? (calendars.find((c) => c.id === prefs.targetCalendarId)?.title ??
      "A calendar that has gone")
    : "Your default calendar";

  const taking =
    prefs.calendarIds.length === 0
      ? "Every calendar"
      : prefs.calendarIds.length === 1
        ? (names[prefs.calendarIds[0] ?? ""] ?? "One calendar")
        : `${prefs.calendarIds.length} calendars`;

  return (
    <>
      <Stack.Screen options={{ title: "Calendar sync", presentation: "modal" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        {permission === "denied" ? (
          <Card style={{ gap: space.md }}>
            <Text style={{ ...type.label, color: t.color.text }}>
              Cal&der cannot see your calendar
            </Text>
            <Muted>
              Your phone is holding the answer you gave the first time it asked.
              Turning Calendars on for Cal&der in Settings is the only way back.
            </Muted>
            <Pressable
              onPress={() => void Linking.openSettings()}
              accessibilityRole="button"
            >
              <Text style={{ ...type.label, color: t.color.accent }}>
                Open Settings
              </Text>
            </Pressable>
          </Card>
        ) : null}

        {permission === "unavailable" ? (
          <Card>
            <Muted>
              This phone has no calendar app that Cal&der can talk to.
            </Muted>
          </Card>
        ) : null}

        <View style={{ gap: space.md }}>
          <Choice
            icon="phone-portrait-outline"
            title="Send to your phone"
            body="Copy events from Cal&der into the calendar app on this phone, so a trip turns up beside everything else you have on."
            note={sentOut.length > 0 ? `${sentOut.length} sent so far` : undefined}
            onPress={() => router.push("/sync/export")}
          />
          <Choice
            icon="download-outline"
            title="Bring events in"
            body="Add what is already in your phone's calendar to a Cal&der calendar, so people can see when you are not free."
            note={broughtIn.length > 0 ? `${broughtIn.length} brought in` : undefined}
            onPress={() => router.push("/sync/import")}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Preferences
          </Text>
          <Group>
            <RowButton
              bare
              label="Automatic"
              value={prefs.auto ? "On" : "Off"}
              onPress={() => router.push("/sync/preferences")}
            />
            <RowButton
              bare
              label="Calendars that sync"
              value={taking}
              onPress={() => router.push("/sync/preferences")}
            />
            <RowButton
              bare
              label="Copies go to"
              value={pending ? "..." : target}
              onPress={() => router.push("/sync/preferences")}
            />
          </Group>
          <Muted>
            {last
              ? `Last synced ${new Date(last).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}.`
              : "Nothing has been synced yet."}
          </Muted>
        </View>
      </ScrollView>
    </>
  );
}

function Choice({
  icon,
  title,
  body,
  note,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  note?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={{ flexDirection: "row", gap: space.lg, alignItems: "flex-start" }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.color.accentSoft,
          }}
        >
          <Ionicons name={icon} size={20} color={t.color.accent} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ ...type.label, fontSize: 16, color: t.color.text }}>
            {title}
          </Text>
          <Text style={{ ...type.caption, color: t.color.textMuted }}>{body}</Text>
          {note ? (
            <Text style={{ ...type.caption, color: t.color.accent }}>{note}</Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
      </Card>
    </Pressable>
  );
}
