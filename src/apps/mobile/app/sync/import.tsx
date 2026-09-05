import type { ImportCandidate, ImportPlan } from "@calder/core";
import { planImport } from "@calder/core";
import { Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";

import { CheckRow, ChoiceRow, PrimaryButton } from "@/components/form";
import { Card, Group, Muted } from "@/components/ui";
import {
  importDeviceEvents,
  listCalendarsICanPostTo,
  listDeviceLinks,
  memberCounts,
} from "@/db/repo";
import { OWN_PLANS_ID } from "@/db/seed";
import { readDeviceEvents, wallTimeIn } from "@/lib/deviceCalendar";
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
  // The copies this app wrote to the phone. Reading them is the whole of the
  // fix for a list that was offering somebody their own exported events back.
  const ourCopies = useQuery("links:out", () => listDeviceLinks("out"));
  const targets = useQuery("calendars:postable", () => listCalendarsICanPostTo());
  const counts = useQuery("calendars:members", () => memberCounts());

  const [sources, setSources] = useState<ReadonlySet<string> | null>(null);
  const [into, setInto] = useState<string>(OWN_PLANS_ID);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
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
      setPlan({ candidates: [], alreadyHere: 0, ours: 0 });
      return;
    }

    let live = true;
    setReading(true);
    void (async () => {
      const events = await readDeviceEvents(sourceIds);
      if (!live) return;
      const next = planImport(events, links, ourCopies) as ImportPlan & {
        candidates: Found[];
      };
      setPlan(next);
      // All of them ticked. Somebody who opened this screen wants their
      // calendar in, and now that the list holds only things that are not here
      // yet, the ones to think about are the ones to untick.
      setChosen(new Set(next.candidates.map((c) => c.deviceEventId)));
      setReading(false);
    })();

    return () => {
      live = false;
    };
  }, [sourceIds, sources, links, ourCopies]);

  const newOnes = (plan?.candidates ?? []) as Found[];
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
          localWall: wallTimeIn(c.startUtc, c.timeZone),
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
              <ChoiceRow
                key={c.calendar_id}
                label={c.name}
                // Who else is in it, on the row where the choice is made. This
                // screen copies what is on somebody's phone into a calendar
                // other people read, so the number of them is the single most
                // relevant fact about each option, and putting it in the
                // footnote underneath would be telling them after the fact.
                note={peopleIn(counts[c.calendar_id] ?? 1)}
                chosen={c.calendar_id === into}
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

            {reading || plan === null ? (
              <ActivityIndicator color={t.color.accent} />
            ) : newOnes.length === 0 ? (
              <Card>
                {/* An empty list has three quite different causes, and saying
                    "nothing found" for all of them makes the app look broken
                    in the two cases where it is working perfectly. */}
                <Muted>{nothingLeft(plan)}</Muted>
              </Card>
            ) : (
              <>
                <Group>
                  <CheckRow
                    label="Select all events"
                    hint={
                      newOnes.length === 1
                        ? "1 not here yet"
                        : `${newOnes.length} not here yet`
                    }
                    checked={allOn}
                    onChange={(on) =>
                      toggleMany(
                        newOnes.map((c) => c.deviceEventId),
                        on,
                      )
                    }
                  />
                </Group>
                <Group>
                  {newOnes.map((c) => (
                    <CheckRow
                      key={c.deviceEventId}
                      label={c.title}
                      hint={whenIs(c.startUtc, c.allDay)}
                      checked={chosen.has(c.deviceEventId)}
                      onChange={(on) => toggleMany([c.deviceEventId], on)}
                    />
                  ))}
                </Group>
                {plan.alreadyHere > 0 ? (
                  <Muted>
                    {plan.alreadyHere === 1
                      ? "1 more is already here from a previous run."
                      : `${plan.alreadyHere} more are already here from previous runs.`}
                  </Muted>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {permission === "granted" && newOnes.length > 0 ? (
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
              {(counts[into] ?? 1) > 1
                ? // Naming the number, and the calendar, at the moment of
                  // pressing: "anyone in that calendar" is a phrase people read
                  // past, and this is somebody's work diary going somewhere
                  // other people read.
                  `These become ordinary events in ${targetName}, where ${counts[into] === 2 ? "1 other person" : `${(counts[into] ?? 1) - 1} other people`} can see them. Your phone's copy is left exactly as it is.`
                : `These become ordinary events in ${targetName}, which is yours alone. Your phone's copy is left exactly as it is.`}
            </Muted>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

/**
 * Why there is nothing to bring in.
 *
 * Three causes that look identical and are not: the calendars are empty, or
 * everything in them has been brought in already, or everything in them is
 * something this app put there. Reporting all three as "nothing found" makes a
 * working sync look broken, and the last one in particular would have somebody
 * hunting for a bug in the two minutes after they turned automatic sync on.
 */
function nothingLeft(plan: ImportPlan): string {
  if (plan.alreadyHere > 0) {
    return "Everything in the calendars you picked is already here.";
  }
  if (plan.ours > 0) {
    return "Nothing new. What is in the calendars you picked was put there by Cal&der.";
  }
  return "Nothing in the next few months in the calendars you picked.";
}

/**
 * Who a calendar is shared with, or nothing at all.
 *
 * A calendar with only you in it says nothing rather than "1 person": the
 * absence is the message, and a count beside every row would make the shared
 * ones stop standing out, which is the only reason the count is here.
 */
function peopleIn(count: number): string | undefined {
  return count > 1 ? `Shared with ${count - 1} other${count > 2 ? "s" : ""}` : undefined;
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
