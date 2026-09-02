import { Ionicons } from "@expo/vector-icons";
import type { DayPresence, TravelMode } from "@uca/core";
import { sharedTravelMode } from "@uca/core";
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

  const parts = [
    phrase(arriving, arriving.length === 1 ? "arrives" : "arrive", "arrivesAt"),
    phrase(leaving, leaving.length === 1 ? "leaves" : "leave", "departsAt"),
  ].filter(Boolean);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space.xs,
      }}
    >
      <Ionicons
        name={TRAVEL_ICON[sharedTravelMode([...arriving, ...leaving], travelMode)]}
        size={14}
        color={t.color.accent}
      />
      <Text style={{ ...type.caption, color: t.color.accent, flex: 1 }}>
        {parts.join(" · ")}
      </Text>
    </View>
  );
}

/** "Priya and Luke", "Priya, Luke and Glenn". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
