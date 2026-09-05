import { Ionicons } from "@expo/vector-icons";
import type { DayPresence, TravelMode } from "@calder/core";
import { groupByTravelMode } from "@calder/core";
import { Text, View } from "react-native";

import { TRAVEL_ICON } from "@/components/TravelMode";
import { formatClock } from "@/lib/format";
import { space, type, useTheme } from "@/theme";

/**
 * The one-line version of who is coming and going on a day, for the calendar's
 * chronological list.
 *
 * Arrivals used to be events ("Flights land"), which put them in the right place
 * in the timeline but the wrong shape — you cannot RSVP to a landing. This keeps
 * the placement and drops the pretence.
 *
 * Only movement is shown. Who is merely *present* is the steady state and
 * belongs on the day screen, not repeated against every day in the list.
 */
export function DayPresenceNote({
  presence,
  tz,
  travelMode,
}: {
  presence: DayPresence;
  tz: string;
  travelMode: TravelMode;
}) {
  const t = useTheme();

  const arriving = presence.arrivingToday;
  const leaving = presence.leavingToday;
  if (arriving.length === 0 && leaving.length === 0) return null;

  const phrase = (
    people: typeof arriving,
    verb: string,
    pick: "arrivesAt" | "departsAt",
  ): string | null => {
    if (people.length === 0) return null;

    // Everyone on the same flight reads better as one clause than three.
    const times = new Set(people.map((p) => formatClock(p[pick] ?? "", tz)));
    const names = joinNames(people.map((p) => p.displayName));

    if (times.size === 1) {
      const [time] = [...times];
      return `${names} ${verb} @ ${time}`;
    }
    return people
      .map((p) => `${p.displayName} @ ${formatClock(p[pick] ?? "", tz)}`)
      .join(", ");
  };

  /**
   * One line per way of travelling, when they differ.
   *
   * "James @ 12:00, Priya @ 12:00, Luke @ 21:00" behind a single aeroplane is
   * wrong twice over: Priya is on a train, and the line implies one departure
   * that people are variously part of. Splitting keeps each icon honest and
   * puts the earliest group first, so the day still reads in order.
   */
  const lines: { key: string; icon: TravelMode; text: string }[] = [];

  if (arriving.length > 0) {
    for (const group of groupByTravelMode(arriving, travelMode, "arrivesAt")) {
      const text = phrase(
        group.people,
        group.people.length === 1 ? "arrives" : "arrive",
        "arrivesAt",
      );
      if (text) lines.push({ key: `in:${group.mode}`, icon: group.mode, text });
    }
  }

  if (leaving.length > 0) {
    for (const group of groupByTravelMode(leaving, travelMode, "departsAt")) {
      const text = phrase(
        group.people,
        group.people.length === 1 ? "leaves" : "leave",
        "departsAt",
      );
      if (text) lines.push({ key: `out:${group.mode}`, icon: group.mode, text });
    }
  }

  return (
    <View style={{ gap: 2, paddingVertical: space.xs }}>
      {lines.map((line) => (
        <View
          key={line.key}
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <Ionicons
            name={TRAVEL_ICON[line.icon]}
            size={14}
            color={t.color.accent}
          />
          <Text style={{ ...type.caption, color: t.color.accent, flex: 1 }}>
            {line.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** "Priya and Luke", "Priya, Luke and Glenn". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
