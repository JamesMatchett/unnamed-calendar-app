import type { ImportCandidate } from "@calder/core";
import { planImport } from "@calder/core";
import { Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";

import { CheckRow, PrimaryButton, RowButton } from "@/components/form";
import { Card, Group, Muted } from "@/components/ui";
import {
  importDeviceEvents,
  listCalendarsICanPostTo,
  listDeviceLinks,
} from "@/db/repo";
import { OWN_PLANS_ID } from "@/db/seed";
import { readDeviceEvents } from "@/lib/deviceCalendar";
import { useDeviceCalendars } from "@/lib/useDeviceCalendar";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

type Found = ImportCandidate & { deviceCalendarId: string; timeZone: string };

/**
 * Bringing what is already on the phone into Cal&der (§5.7).
 *
 * The order of the questions is the order they actually get answered: which of
 * your phone's calendars to look at, where the events should land, and only
 * then which events. Asking for the destination last, after somebody has ticked
 * thirty things, is how a screen loses thirty ticks.
 *
 * Events brought in before are shown ticked and greyed rather than dropped,
 * with "already here" beside them. The alternative is a list that silently
 * shrinks every time it is used, leaving somebody to wonder whether the meeting
 * they were looking for was skipped or never existed.
 */
export default function ImportScreen() {
  const t = useTheme();
  const router = useRouter();

  const { permission, calendars, pending } = useDeviceCalendars();
  const links = useQuery("links:in", () => listDeviceLinks("in"));
  const targets = useQuery("calendars:postable", () => listCalendarsICanPostTo());

  const [sources, setSources] = useState<ReadonlySet<string> | null>(null);
  const [into, setInto] = useState<string>(OWN_PLANS_ID);
  const [found, setFound] = useState<Found[] | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);

  // Writable calendars are the ones a person keeps their own life in, so they
  // are ticked to begin with. Subscribed calendars, which are the sports
  // fixtures and the national holidays, are offered but not assumed: importing
  // them is a legitimate choice and a terrible default.
  useEffect(() => {
    if (sources !== null || calendars.length === 0) return;
    setSources(new Set(calendars.filter((c) => c.writable).map((c) => c.id)));
  }, [calendars, sources]);

  // Memoised so it is a stable dependency: without it the effect below would
  // rebuild its array every render and re-read the whole phone calendar on
  // every keystroke-sized state change.
  const sourceIds = useMemo(() => [...(sources ?? [])].sort(), [sources]);

  useEffect(() => {
    if (sources === null) return;
    if (sourceIds.length === 0) {
      setFound([]);
      return;
    }

    let live = true;
    setReading(true);
    void (async () => {
      const events = await readDeviceEvents(sourceIds);
      if (!live) return;
      const candidates = planImport(events, links) as Found[];
      setFound(candidates);
      // Anything new is ticked. Somebody who opened this screen wants their
      // calendar in; the ones they have to think about are the ones to untick.
      setChosen(
        new Set(candidates.filter((c) => !c.alreadyHere).map((c) => c.deviceEventId)),
      );
      setReading(false);
    })();

    return () => {
      live = false;
    };
  }, [sourceIds, sources, links]);

  const newOnes = (found ?? []).filter((c) => !c.alreadyHere);
  const selected = newOnes.filter((c) => chosen.has(c.deviceEventId));
  const allOn = newOnes.length > 0 && selected.length === newOnes.length;
  const targetName =
    targets.find((c) => c.calendar_id === into)?.name ?? "Pick a calendar";

  const toggleMany = (ids: readonly string[], on: boolean) =>
    setChosen((was) => {
      const next = new Set(was);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  function run() {
    setRunning(true);
    try {
      const written = importDeviceEvents(
        into,
        selected.map((c) => ({
          deviceEventId: c.deviceEventId,
          deviceCalendarId: c.deviceCalendarId,
          title: c.title,
          startUtc: c.startUtc,
          endUtc: c.endUtc,
          // The wall time is derived from the event's own zone, not this
          // phone's: a meeting created in New York keeps saying 9am when the
          // person carrying the phone lands in London.
          localWall: wallTime(c.startUtc, c.timeZone),
          tz: c.timeZone,
          allDay: c.allDay,
        })),
      );

      Alert.alert(
        written === 1 ? "One event brought in" : `${written} events brought in`,
        `They are in ${targetName} now. Changing them here does not change them on your phone.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Bring events in" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        {permission === "denied" ? (
          <Card style={{ gap: space.md }}>
            <Text style={{ ...type.label, color: t.color.text }}>
              Cal&der cannot see your calendar
            </Text>
            <Muted>
              Turn Calendars on for Cal&der in your phone's settings, then come
              back.
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

        {permission === "granted" ? (
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
                    checked={sources?.has(c.id) ?? false}
                    onChange={(on) =>
                      setSources((was) => {
                        const next = new Set(was ?? []);
                        if (on) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                  />
                ))}
              </Group>
            )}
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>They go into</Text>
          <Group>
            {targets.map((c) => (
              <RowButton
                bare
                key={c.calendar_id}
                label={c.name}
                value={c.calendar_id === into ? "✓" : ""}
                active={c.calendar_id === into}
                onPress={() => setInto(c.calendar_id)}
              />
            ))}
          </Group>
        </View>

        {permission === "granted" ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>
              What to bring in
            </Text>

            {reading || found === null ? (
              <ActivityIndicator color={t.color.accent} />
            ) : found.length === 0 ? (
              <Card>
                <Muted>
                  Nothing in the next few months in the calendars you picked.
                </Muted>
              </Card>
            ) : (
              <>
                <Group>
                  <CheckRow
                    label="Select all events"
                    hint={`${newOnes.length} not here yet`}
                    checked={allOn}
                    onChange={(on) =>
                      toggleMany(
                        newOnes.map((c) => c.deviceEventId),
                        on,
                      )
                    }
                    disabled={newOnes.length === 0}
                  />
                </Group>
                <Group>
                  {found.map((c) => (
                    <CheckRow
                      key={c.deviceEventId}
                      label={c.title}
                      hint={whenIs(c.startUtc, c.allDay)}
                      checked={c.alreadyHere || chosen.has(c.deviceEventId)}
                      disabled={c.alreadyHere}
                      note={c.alreadyHere ? "already here" : undefined}
                      onChange={(on) => toggleMany([c.deviceEventId], on)}
                    />
                  ))}
                </Group>
              </>
            )}
          </View>
        ) : null}

        {permission === "granted" && (found?.length ?? 0) > 0 ? (
          <View style={{ gap: space.sm }}>
            {running ? (
              <ActivityIndicator color={t.color.accent} />
            ) : (
              <PrimaryButton
                label={
                  selected.length === 0
                    ? "Nothing to bring in"
                    : `Bring in ${selected.length}`
                }
                onPress={run}
                disabled={selected.length === 0}
              />
            )}
            <Muted>
              These become ordinary events in {targetName}, so anyone in that
              calendar can see them. Your phone's copy is left exactly as it is.
            </Muted>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

/** "2026-09-12T09:00:00", in the event's own zone. */
function wallTime(instant: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));
  const at = (name: string) => parts.find((p) => p.type === name)?.value ?? "00";
  // en-CA gives midnight as "24" rather than "00" in some engines.
  const hour = at("hour") === "24" ? "00" : at("hour");
  return `${at("year")}-${at("month")}-${at("day")}T${hour}:${at("minute")}:${at("second")}`;
}

function whenIs(startUtc: string, allDay: boolean): string {
  const d = new Date(startUtc);
  const day = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return allDay
    ? `${day}, all day`
    : `${day}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}
