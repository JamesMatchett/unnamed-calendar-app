import { syncsCalendar } from "@calder/core";
import { Stack } from "expo-router";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";

import { CheckRow, RowButton, ToggleRow } from "@/components/form";
import { Card, Group, Muted } from "@/components/ui";
import { getSyncPrefs, listCalendars, setSyncPrefs } from "@/db/repo";
import { accountsFrom } from "@/lib/deviceCalendar";
import { useDeviceCalendars } from "@/lib/useDeviceCalendar";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

/**
 * How syncing behaves when nobody is watching it (§5.7).
 *
 * Three questions, in the order they depend on each other: whether it happens
 * on its own, which Cal&der calendars it covers, and where on the phone the
 * copies land.
 *
 * The account list at the bottom is the honest form of a placeholder. Somebody
 * looking for "sync to Google Calendar" is looking for an account, not a
 * calendar, and offering Google as a tickable option when this phone has no
 * Google account signed in would be a button that does nothing. So accounts
 * that are set up are shown with their calendars, and accounts that are not are
 * shown greyed with what to do about it, which is a thing only the phone's own
 * settings can do.
 */
export default function SyncPreferencesScreen() {
  const t = useTheme();

  const prefs = useQuery("sync:prefs", () => getSyncPrefs());
  const mine = useQuery("calendars", () => listCalendars());
  const { permission, calendars, pending } = useDeviceCalendars();

  const everyCalendar = prefs.calendarIds.length === 0;
  const accounts = accountsFrom(calendars);
  const writable = calendars.filter((c) => c.writable);

  const setCalendar = (calendarId: string, on: boolean) => {
    // "Empty means all" is the stored shape, so unticking one calendar out of
    // an implicit all has to first make the all explicit. Without this, the
    // first untick would appear to do nothing at all.
    const base = everyCalendar ? mine.map((c) => c.calendar_id) : [...prefs.calendarIds];
    const next = on
      ? [...new Set([...base, calendarId])]
      : base.filter((id) => id !== calendarId);
    // Every calendar ticked is the same thing as the default, and storing it as
    // the default means a calendar made tomorrow is included rather than
    // silently left out of a list written today.
    setSyncPrefs({
      ...prefs,
      calendarIds: next.length === mine.length ? [] : next,
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: "Sync preferences" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <ToggleRow
            label="Sync automatically"
            hint="Keeps the copies on your phone up to date after you add or change an event, without opening this screen."
            value={prefs.auto}
            onChange={(auto) => setSyncPrefs({ ...prefs, auto })}
          />
          <Muted>
            {prefs.auto
              ? "New events in the calendars below are copied to your phone on their own. Anything with no date set waits until it has one."
              : "Nothing is copied until you press the button on the sync screen."}
          </Muted>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Calendars that sync
          </Text>
          <Group>
            <CheckRow
              label="Every calendar"
              hint="Including ones you join later"
              checked={everyCalendar}
              onChange={(on) =>
                setSyncPrefs({
                  ...prefs,
                  // Unticking "every" starts from every calendar ticked rather
                  // than none, because it means "let me take some out".
                  calendarIds: on ? [] : mine.map((c) => c.calendar_id),
                })
              }
            />
            {mine.map((c) => (
              <CheckRow
                key={c.calendar_id}
                label={c.name}
                checked={syncsCalendar(prefs, c.calendar_id)}
                disabled={everyCalendar}
                onChange={(on) => setCalendar(c.calendar_id, on)}
              />
            ))}
          </Group>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Copies go to
          </Text>

          {permission !== "granted" ? (
            <Card style={{ gap: space.md }}>
              <Muted>
                Cal&der needs access to your calendar before it can offer you
                one to write to.
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
          ) : pending ? (
            <ActivityIndicator color={t.color.accent} />
          ) : (
            <Group>
              <RowButton
                bare
                label="Your default calendar"
                value={prefs.targetCalendarId === null ? "✓" : ""}
                active={prefs.targetCalendarId === null}
                onPress={() =>
                  setSyncPrefs({ ...prefs, targetCalendarId: null, targetAccount: null })
                }
              />
              {writable.map((c) => (
                <RowButton
                  bare
                  key={c.id}
                  label={`${c.title}  ·  ${c.account}`}
                  value={prefs.targetCalendarId === c.id ? "✓" : ""}
                  active={prefs.targetCalendarId === c.id}
                  onPress={() =>
                    setSyncPrefs({
                      ...prefs,
                      targetCalendarId: c.id,
                      targetAccount: c.account,
                    })
                  }
                />
              ))}
            </Group>
          )}
          <Muted>
            Whichever calendar app you use, this is where Cal&der's copies
            appear. Read only calendars, like a subscribed holidays one, are not
            listed because nothing can write to them.
          </Muted>
        </View>

        {permission === "granted" ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>
              Accounts on this phone
            </Text>
            <Group>
              {accounts.map((a) => (
                <RowButton
                  bare
                  key={a.name}
                  label={a.name}
                  value={
                    a.calendars === 0
                      ? "Not set up"
                      : a.calendars === 1
                        ? "1 calendar"
                        : `${a.calendars} calendars`
                  }
                  onPress={() => void Linking.openSettings()}
                />
              ))}
            </Group>
            <Muted>
              Cal&der writes to whatever your phone already syncs. Adding a
              Google or Outlook account is done in your phone's own settings,
              and its calendars then show up in the list above.
            </Muted>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
