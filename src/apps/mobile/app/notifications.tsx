import type { NotifyGroup, ReminderOffset } from "@calder/core";
import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";

import { CheckRow, PrimaryButton, RowButton, ToggleRow } from "@/components/form";
import { Card, Group, Muted } from "@/components/ui";
import { getNotifyPrefs, setNotifyPrefs } from "@/db/repo";
import type { Permission } from "@/lib/notifications";
import {
  PUSH_AVAILABLE,
  currentPermission,
  ensurePermission,
  present,
  scheduledCount,
} from "@/lib/notifications";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * What Cal&der is allowed to interrupt you for (§7.3).
 *
 * Grouped rather than one switch per kind, because fifteen switches is a screen
 * nobody reads, and the kinds inside a group rise and fall together: somebody
 * who wants to hear about invitations wants all three sorts of invitation.
 *
 * Reminders are last and are a different thing from the rest. Everything above
 * them is news about other people, which needs a server and is honestly limited
 * until there is one. Reminders are a real schedule the phone holds, which
 * fires whether or not the app is running, and they work today. The screen says
 * so rather than letting somebody discover the difference by being let down.
 */

const GROUPS: { value: NotifyGroup; label: string; hint: string }[] = [
  {
    value: "invitations",
    label: "Invitations and requests",
    hint: "Being invited to a calendar, friend requests, and people asking to join a calendar you own.",
  },
  {
    value: "events",
    label: "New events",
    hint: "When somebody adds something to a calendar you are in.",
  },
  {
    value: "picking_times",
    label: "Picking a time",
    hint: "When somebody puts up possible times and is waiting to hear which suit you.",
  },
  {
    value: "rsvps",
    label: "Are you coming",
    hint: "When somebody is waiting on your answer to an event.",
  },
  {
    value: "joining",
    label: "People joining",
    hint: "When somebody joins a calendar you own, through a link.",
  },
  {
    value: "changes",
    label: "Changes and cancellations",
    hint: "Events called off or edited, and changes to who owns what.",
  },
];

const OFFSETS: { value: ReminderOffset; label: string; hint: string }[] = [
  { value: "start", label: "When it starts", hint: "All-day events say so that morning" },
  { value: "1h", label: "An hour before", hint: "Skipped for all-day events" },
  { value: "1d", label: "The day before", hint: "All-day events say so the morning before" },
];

export default function NotificationsScreen() {
  const t = useTheme();
  const prefs = useQuery("notify:prefs", () => getNotifyPrefs());

  const [permission, setPermission] = useState<Permission | null>(null);
  const [queued, setQueued] = useState<number | null>(null);

  // Checked rather than asked on arriving: the request belongs to the moment
  // somebody switches something on, not to opening a settings screen.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [now, count] = await Promise.all([currentPermission(), scheduledCount()]);
      if (!live) return;
      setPermission(now);
      setQueued(count);
    })();
    return () => {
      live = false;
    };
  }, [prefs]);

  const ask = async () => {
    const answer = await ensurePermission();
    setPermission(answer);
  };

  const muted = (group: NotifyGroup) => prefs.muted.includes(group);

  const setMuted = (group: NotifyGroup, on: boolean) =>
    setNotifyPrefs({
      ...prefs,
      // Stored as what is OFF, so a group added in a later version reaches
      // people rather than being silently withheld from everybody who saved
      // their preferences before it existed.
      muted: on
        ? prefs.muted.filter((g) => g !== group)
        : [...new Set([...prefs.muted, group])],
    });

  const setOffset = (offset: ReminderOffset, on: boolean) =>
    setNotifyPrefs({
      ...prefs,
      remindAt: on
        ? [...new Set([...prefs.remindAt, offset])]
        : prefs.remindAt.filter((o) => o !== offset),
    });

  return (
    <>
      <Stack.Screen options={{ title: "Notifications", presentation: "modal" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        {permission === "denied" ? (
          <Card style={{ gap: space.md }}>
            <Text style={{ ...type.label, color: t.color.text }}>
              Notifications are turned off for Cal&der
            </Text>
            <Muted>
              Everything below is saved, and none of it can reach you until
              Notifications are turned back on in your phone's settings.
            </Muted>
            <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button">
              <Text style={{ ...type.label, color: t.color.accent }}>Open Settings</Text>
            </Pressable>
          </Card>
        ) : null}

        <View style={{ gap: space.sm }}>
          <ToggleRow
            label="Notifications"
            hint="The one switch above all the others. Off means Cal&der stays silent."
            value={prefs.enabled}
            onChange={(enabled) => {
              setNotifyPrefs({ ...prefs, enabled });
              // Asked here, at the moment it is switched on, which is the only
              // moment the question makes sense.
              if (enabled && permission !== "granted") void ask();
            }}
          />
        </View>

        {prefs.enabled ? (
          <>
            <View style={{ gap: space.sm }}>
              <Text style={{ ...type.label, color: t.color.textMuted }}>
                Tell me about
              </Text>
              <Group>
                {GROUPS.map((g) => (
                  <CheckRow
                    key={g.value}
                    label={g.label}
                    hint={g.hint}
                    checked={!muted(g.value)}
                    onChange={(on) => setMuted(g.value, on)}
                  />
                ))}
              </Group>
              {!PUSH_AVAILABLE ? (
                <Notice>
                  While Cal&der is running in Expo Go these arrive only when the
                  app is open. Reaching a phone that is asleep needs a real
                  build and the server behind it, both of which are still to
                  come.
                </Notice>
              ) : null}
            </View>

            <View style={{ gap: space.sm }}>
              <Text style={{ ...type.label, color: t.color.textMuted }}>
                Remind me about an event
              </Text>
              <Group>
                {OFFSETS.map((o) => (
                  <CheckRow
                    key={o.value}
                    label={o.label}
                    hint={o.hint}
                    checked={prefs.remindAt.includes(o.value)}
                    onChange={(on) => setOffset(o.value, on)}
                  />
                ))}
              </Group>
              <Muted>
                {prefs.remindAt.length === 0
                  ? "No reminders. Nothing will tell you an event is coming up."
                  : queued === null
                    ? "Reminders are set on this phone and arrive whether or not Cal&der is open."
                    : `${queued} ${queued === 1 ? "reminder is" : "reminders are"} set on this phone. They arrive whether or not Cal&der is open.`}
              </Muted>
            </View>

            {/* Alpha only. There is no other way to find out whether
                notifications actually reach this particular phone, and
                "it did not work" without knowing which half failed is a
                bug report nobody can act on. */}
            <View style={{ gap: space.sm }}>
              <Text style={{ ...type.label, color: t.color.textMuted }}>
                Check it works
              </Text>
              <Group>
                <RowButton
                  bare
                  label="Permission"
                  value={
                    permission === "granted"
                      ? "Allowed"
                      : permission === "denied"
                        ? "Refused"
                        : permission === null
                          ? "..."
                          : "Not available"
                  }
                  onPress={() => void ask()}
                />
              </Group>
              <PrimaryButton
                label="Send a test notification"
                variant="ghost"
                onPress={() =>
                  void present("Cal&der", "This is what a notification looks like.")
                }
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function Notice({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: t.color.accentSoft,
      }}
    >
      <Text style={{ ...type.caption, color: t.color.text }}>{children}</Text>
    </View>
  );
}
