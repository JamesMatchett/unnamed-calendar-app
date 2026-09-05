import { autoSelection, planExport } from "@calder/core";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";

import { CheckRow, PrimaryButton, RowButton } from "@/components/form";
import { Card, Group, Muted } from "@/components/ui";
import {
  calendarNames,
  commitExport,
  exportableEvents,
  getSyncPrefs,
  listDeviceLinks,
} from "@/db/repo";
import { applyExport, defaultCalendarId } from "@/lib/deviceCalendar";
import { useDeviceCalendars } from "@/lib/useDeviceCalendar";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

/**
 * Choosing what goes onto the phone (§5.7).
 *
 * The list is grouped by Cal&der calendar and every level can be ticked: all of
 * it, one calendar, one event. That is three controls for one idea, which is
 * usually a smell, but here each is the natural unit of a different intention.
 * "Put my trips on my phone" is a calendar. "Just the flight" is an event.
 * "Everything" is the answer most people want and should not cost twenty taps.
 *
 * Events with no settled date are shown, ticked off and greyed, rather than
 * hidden. A poll that has not landed is exactly the thing somebody would go
 * looking for in this list, and an event that is simply absent reads as a bug.
 */
export default function ExportScreen() {
  const t = useTheme();
  const router = useRouter();

  const events = useQuery("sync:exportable", () => exportableEvents());
  const names = useQuery("calendar:names", () => calendarNames());
  const links = useQuery("links:out", () => listDeviceLinks("out"));
  const prefs = useQuery("sync:prefs", () => getSyncPrefs());
  const { calendars, pending } = useDeviceCalendars();

  // Everything the preferences say takes part, ticked, as the opening position.
  // Starting from nothing selected would mean the common case is the most work.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() =>
    autoSelection(events, prefs),
  );
  const [running, setRunning] = useState(false);

  // Cancelled events are not offered: there is nothing to send, and their
  // existing copies are removed by planExport whether they appear here or not.
  const offered = useMemo(() => events.filter((e) => e.status === "active"), [events]);
  const sendable = useMemo(
    () => offered.filter((e) => e.precision !== "tbc"),
    [offered],
  );

  const byCalendar = useMemo(() => {
    const groups = new Map<string, typeof offered>();
    for (const e of offered) {
      const list = groups.get(e.calendarId);
      if (list) list.push(e);
      else groups.set(e.calendarId, [e]);
    }
    return [...groups].sort(([a], [b]) =>
      (names[a] ?? "").localeCompare(names[b] ?? ""),
    );
  }, [offered, names]);

  const selectedSendable = sendable.filter((e) => chosen.has(e.eventId));
  const allOn = sendable.length > 0 && selectedSendable.length === sendable.length;

  const target = prefs.targetCalendarId
    ? (calendars.find((c) => c.id === prefs.targetCalendarId)?.title ??
      "Your default calendar")
    : "Your default calendar";

  const toggle = (eventId: string, on: boolean) =>
    setChosen((was) => {
      const next = new Set(was);
      if (on) next.add(eventId);
      else next.delete(eventId);
      return next;
    });

  const toggleMany = (ids: readonly string[], on: boolean) =>
    setChosen((was) => {
      const next = new Set(was);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  // Planned against the FULL event list, not the filtered one: an event that
  // has been cancelled, or has lost its date, still has a copy on the phone
  // that this run is responsible for taking away.
  const plan = planExport(events, chosen, links);
  const creating = plan.filter((a) => a.kind === "create").length;
  const updating = plan.filter((a) => a.kind === "update").length;
  const removing = plan.filter((a) => a.kind === "remove").length;

  async function run() {
    setRunning(true);
    try {
      const to = prefs.targetCalendarId ?? (await defaultCalendarId());
      if (!to) {
        Alert.alert(
          "Nowhere to put them",
          "This phone has no calendar Cal&der is allowed to write to. Pick one under Preferences, or add an account in your phone's settings.",
        );
        return;
      }

      const result = await applyExport(plan, events, to);
      commitExport(result, to, events);

      const wrote = result.created.length + result.updated.length;
      Alert.alert(
        "Done",
        [
          wrote > 0 ? `${wrote} ${wrote === 1 ? "event is" : "events are"} on your phone.` : null,
          result.removed.length > 0
            ? `${result.removed.length} taken back off.`
            : null,
          result.failed > 0
            ? `${result.failed} could not be written. They are still here and will be tried again next time.`
            : null,
          wrote === 0 && result.removed.length === 0 && result.failed === 0
            ? "Nothing needed changing."
            : null,
        ]
          .filter(Boolean)
          .join(" "),
        [{ text: "OK", onPress: () => router.back() }],
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Send to your phone" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <Group>
          <RowButton
            bare
            label="Copies go to"
            value={pending ? "..." : target}
            onPress={() => router.push("/sync/preferences")}
          />
        </Group>

        {offered.length === 0 ? (
          <Card>
            <Muted>
              Nothing to send yet. Add an event to a calendar and it will show up
              here.
            </Muted>
          </Card>
        ) : (
          <>
            <Group>
              <CheckRow
                label="Select all events"
                hint={`${sendable.length} with a date set`}
                checked={allOn}
                onChange={(on) =>
                  toggleMany(
                    sendable.map((e) => e.eventId),
                    on,
                  )
                }
              />
            </Group>

            {byCalendar.map(([calendarId, list]) => {
              const theirs = list.filter((e) => e.precision !== "tbc");
              const on =
                theirs.length > 0 &&
                theirs.every((e) => chosen.has(e.eventId));

              return (
                <View key={calendarId} style={{ gap: space.sm }}>
                  <Text style={{ ...type.label, color: t.color.textMuted }}>
                    {names[calendarId] ?? "A calendar"}
                  </Text>
                  <Group>
                    <CheckRow
                      label="Everything in this calendar"
                      checked={on}
                      onChange={(next) =>
                        toggleMany(
                          theirs.map((e) => e.eventId),
                          next,
                        )
                      }
                      disabled={theirs.length === 0}
                    />
                    {list.map((e) => (
                      <CheckRow
                        key={e.eventId}
                        label={e.title}
                        hint={whenIs(e.startUtc, e.precision)}
                        checked={e.precision !== "tbc" && chosen.has(e.eventId)}
                        onChange={(next) => toggle(e.eventId, next)}
                        disabled={e.precision === "tbc"}
                        note={
                          e.precision === "tbc"
                            ? "no date yet"
                            : links.some((l) => l.eventId === e.eventId)
                              ? "on your phone"
                              : undefined
                        }
                      />
                    ))}
                  </Group>
                </View>
              );
            })}
          </>
        )}

        {offered.length > 0 ? (
          <View style={{ gap: space.sm }}>
            {running ? (
              <ActivityIndicator color={t.color.accent} />
            ) : (
              <PrimaryButton
                label={buttonLabel(creating, updating, removing)}
                onPress={() => void run()}
                disabled={plan.length === 0}
              />
            )}
            <Muted>
              {removing > 0
                ? `${removing} ${removing === 1 ? "copy" : "copies"} will be taken off your phone, because ${removing === 1 ? "it is" : "they are"} no longer ticked.`
                : plan.length === 0 && selectedSendable.length > 0
                  ? // Without this the screen looks broken on the second visit:
                    // everything ticked, a dead button, and no reason given.
                    "Everything you have ticked is already on your phone and up to date."
                  : "Only the events you have ticked are copied. Nothing else on your phone is touched."}
            </Muted>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function buttonLabel(creating: number, updating: number, removing: number): string {
  if (creating === 0 && updating === 0 && removing === 0) return "Nothing to send";
  const parts: string[] = [];
  if (creating > 0) parts.push(`Send ${creating}`);
  if (updating > 0) parts.push(`update ${updating}`);
  if (removing > 0) parts.push(`remove ${removing}`);
  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Short and local: this list is scanned, not read. */
function whenIs(startUtc: string, precision: "datetime" | "date" | "tbc"): string {
  if (precision === "tbc") return "Being decided";
  const d = new Date(startUtc);
  const day = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (precision === "date") return `${day}, all day`;
  return `${day}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}
