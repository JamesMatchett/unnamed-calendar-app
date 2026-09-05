import { importsFrom, syncsCalendar } from "@calder/core";
import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";

import { CheckRow, ChoiceRow, RowButton, ToggleRow } from "@/components/form";
import { Card, Group, Muted } from "@/components/ui";
import {
  getSyncPrefs,
  listCalendars,
  listCalendarsICanPostTo,
  memberCounts,
  setSyncPrefs,
} from "@/db/repo";
import { OWN_PLANS_ID } from "@/db/seed";
import { accountsFrom } from "@/lib/deviceCalendar";
import { useDeviceCalendars } from "@/lib/useDeviceCalendar";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * How syncing behaves when nobody is watching it (§5.7).
 *
 * Split by direction, because the two are not variations of one setting. Going
 * out is your own plans landing on your own phone. Coming in is your phone's
 * diary landing somewhere other people may be able to read. The screen says so
 * rather than presenting them as a matched pair of switches.
 *
 * The account list at the bottom is the honest form of a placeholder. Somebody
 * looking for "sync to Google Calendar" is looking for an account, not a
 * calendar, and offering Google as a tickable option when this phone has no
 * Google account signed in would be a button that does nothing. So accounts
 * that are set up are shown with their calendars, and accounts that are not are
 * shown as not set up, which only the phone's own settings can change.
 */
export default function SyncPreferencesScreen() {
  const t = useTheme();

  const prefs = useQuery("sync:prefs", () => getSyncPrefs());
  const mine = useQuery("calendars", () => listCalendars());
  const targets = useQuery("calendars:postable", () => listCalendarsICanPostTo());
  const counts = useQuery("calendars:members", () => memberCounts());
  const { permission, calendars, pending } = useDeviceCalendars();

  const everyCalendar = prefs.calendarIds.length === 0;
  const accounts = accountsFrom(calendars);
  const writable = calendars.filter((c) => c.writable);
  const landsIn = prefs.importInto ?? OWN_PLANS_ID;
  const shared = (counts[landsIn] ?? 1) - 1;

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

  const setSource = (deviceCalendarId: string, on: boolean) =>
    setSyncPrefs({
      ...prefs,
      importFrom: on
        ? [...new Set([...prefs.importFrom, deviceCalendarId])]
        : prefs.importFrom.filter((id) => id !== deviceCalendarId),
    });

  return (
    <>
      <Stack.Screen options={{ title: "Sync preferences" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        {/* ---------- out ---------- */}

        <Text style={{ ...type.heading, color: t.color.text }}>
          Sending to your phone
        </Text>

        <View style={{ gap: space.sm, marginTop: -space.md }}>
          <ToggleRow
            label="Send automatically"
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
            <NeedsAccess />
          ) : pending ? (
            <ActivityIndicator color={t.color.accent} />
          ) : (
            <Group>
              <ChoiceRow
                label="Your default calendar"
                note="Whatever your phone adds new events to"
                chosen={prefs.targetCalendarId === null}
                onPress={() =>
                  setSyncPrefs({ ...prefs, targetCalendarId: null, targetAccount: null })
                }
              />
              {writable.map((c) => (
                <ChoiceRow
                  key={c.id}
                  label={c.title}
                  note={c.account}
                  chosen={prefs.targetCalendarId === c.id}
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

        {/* ---------- in ---------- */}

        <Text style={{ ...type.heading, color: t.color.text }}>
          Bringing events in
        </Text>

        <View style={{ gap: space.sm, marginTop: -space.md }}>
          <ToggleRow
            label="Bring new events in automatically"
            hint="Adds anything new from the phone calendars below, when you open Cal&der and when you come back to it."
            value={prefs.autoImport}
            onChange={(on) =>
              setSyncPrefs({
                ...prefs,
                autoImport: on,
                // Turning it on with nothing chosen would be a switch that does
                // nothing, so it starts from the calendars a person keeps their
                // own life in. Subscribed ones, the holidays and the fixtures,
                // stay off: importing them is a fair choice and a poor default.
                importFrom:
                  on && prefs.importFrom.length === 0
                    ? writable.map((c) => c.id)
                    : prefs.importFrom,
              })
            }
          />
          {prefs.autoImport && prefs.importFrom.length === 0 ? (
            <Notice>
              Nothing is being brought in, because no calendar below is ticked.
            </Notice>
          ) : null}
        </View>

        {permission === "granted" ? (
          <>
            <View style={{ gap: space.sm }}>
              <Text style={{ ...type.label, color: t.color.textMuted }}>
                Read from
              </Text>
              {pending ? (
                <ActivityIndicator color={t.color.accent} />
              ) : calendars.length === 0 ? (
                <Card>
                  <Muted>There are no calendars on this phone yet.</Muted>
                </Card>
              ) : (
                <Group>
                  {calendars.map((c) => (
                    <CheckRow
                      key={c.id}
                      label={c.title}
                      hint={c.account}
                      tint={c.colour}
                      checked={importsFrom(prefs, c.id)}
                      onChange={(on) => setSource(c.id, on)}
                    />
                  ))}
                </Group>
              )}
            </View>

            <View style={{ gap: space.sm }}>
              <Text style={{ ...type.label, color: t.color.textMuted }}>
                They go into
              </Text>
              <Group>
                {targets.map((c) => {
                  const others = (counts[c.calendar_id] ?? 1) - 1;
                  return (
                    <ChoiceRow
                      key={c.calendar_id}
                      label={c.name}
                      note={
                        c.calendar_id === OWN_PLANS_ID
                          ? "Yours alone"
                          : others > 0
                            ? `Shared with ${others} other${others > 1 ? "s" : ""}`
                            : undefined
                      }
                      chosen={c.calendar_id === landsIn}
                      onPress={() =>
                        setSyncPrefs({
                          ...prefs,
                          // Own plans is stored as null rather than its id: it
                          // is the one calendar guaranteed to exist, so the
                          // fallback and the choice stay the same thing.
                          importInto:
                            c.calendar_id === OWN_PLANS_ID ? null : c.calendar_id,
                        })
                      }
                    />
                  );
                })}
              </Group>
              {shared > 0 ? (
                <Notice>
                  Everything brought in from your phone becomes an ordinary
                  event here, so {shared === 1 ? "1 other person" : `${shared} other people`}{" "}
                  will see it. Your own plans is the only calendar nobody else
                  can read.
                </Notice>
              ) : (
                <Muted>
                  Your own plans is yours alone, which is why it is the default:
                  what is on your phone stays between you and the app.
                </Muted>
              )}
            </View>
          </>
        ) : (
          <NeedsAccess />
        )}

        {/* ---------- the phone itself ---------- */}

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
              and its calendars then show up in the lists above.
            </Muted>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function NeedsAccess() {
  const t = useTheme();
  return (
    <Card style={{ gap: space.md }}>
      <Muted>
        Cal&der needs access to your calendar before it can offer you one to
        read or write.
      </Muted>
      <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button">
        <Text style={{ ...type.label, color: t.color.accent }}>Open Settings</Text>
      </Pressable>
    </Card>
  );
}

/**
 * A consequence worth reading, rather than a hint worth skipping.
 *
 * Muted grey is right for explanation and wrong for "other people will see
 * this": the one line on the screen that changes what somebody would choose
 * should not be the faintest thing on it.
 */
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
