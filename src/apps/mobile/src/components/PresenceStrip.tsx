import { Ionicons } from "@expo/vector-icons";
import type { DayPresence, PresenceInput, TravelMode } from "@calder/core";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { groupByTravelMode, sharedTravelMode, travelModeFor } from "@calder/core";

import { TRAVEL_ICON } from "@/components/TravelMode";
import { formatClock } from "@/lib/format";
import { radius, space, type, useTheme } from "@/theme";

import { Card } from "./ui";

/**
 * Who is around on this day (§4.3).
 *
 * Arrivals are not events — nobody RSVPs to a flight landing — so they get their
 * own representation rather than sitting in the list looking like a dinner.
 *
 * Names are shown whenever they fit, because "Priya and Luke are here" answers
 * the question and "2 people are here" only halves it. When they do not fit, the
 * count becomes a button rather than truncating a name to "Pri…", which would be
 * worse than a number.
 */

type GroupKey = keyof DayPresence;

const GROUPS: {
  key: GroupKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "here" | "moving" | "away";
}[] = [
  { key: "arrivingToday", label: "Arriving today", icon: "airplane-outline", tone: "moving" },
  { key: "here", label: "Already here", icon: "checkmark-circle-outline", tone: "here" },
  { key: "leavingToday", label: "Leaving today", icon: "exit-outline", tone: "moving" },
  { key: "stillToCome", label: "Still to come", icon: "time-outline", tone: "away" },
  { key: "alreadyGone", label: "Already left", icon: "log-out-outline", tone: "away" },
  { key: "unknown", label: "Haven't said", icon: "help-circle-outline", tone: "away" },
];

interface Row {
  id: string;
  /** Which presence group this came from, so times and icons read correctly. */
  key: GroupKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "here" | "moving" | "away";
  people: readonly PresenceInput[];
}

const ARRIVING_LABEL: Record<TravelMode, string> = {
  plane: "Flying in",
  train: "Arriving by train",
  car: "Driving in",
  boat: "Arriving by boat",
  walk: "Walking in",
};

const LEAVING_LABEL: Record<TravelMode, string> = {
  plane: "Flying out",
  train: "Leaving by train",
  car: "Driving off",
  boat: "Leaving by boat",
  walk: "Leaving on foot",
};

/**
 * Roughly how many characters fit, from the measured width. A per-character
 * average is approximate, but it fails in the safe direction: a slightly early
 * switch to the count is invisible, whereas a late one truncates a name.
 */
const CHAR_WIDTH = 6.7;

/**
 * "Luke" answers who. "Luke 18:30" answers who and when, which for an arrival is
 * the part people actually need — it decides whether to wait for them at dinner.
 */
function describe(p: PresenceInput, key: GroupKey, tz: string): string {
  const at =
    key === "arrivingToday"
      ? p.arrivesAt
      : key === "leavingToday"
        ? p.departsAt
        : null;
  return at ? `${p.displayName} @ ${formatClock(at, tz)}` : p.displayName;
}

export function PresenceStrip({
  presence,
  tz,
  travelMode,
}: {
  presence: DayPresence;
  tz: string;
  travelMode: TravelMode;
}) {
  const t = useTheme();
  const [valueWidth, setValueWidth] = useState(0);
  const [showing, setShowing] = useState<{
    label: string;
    people: readonly PresenceInput[];
    key: GroupKey;
  } | null>(null);

  const groups = GROUPS.filter((g) => presence[g.key].length > 0).flatMap(
    (g): Row[] => {
      const people = presence[g.key];

      // Departures split by how people are going. Three drive off after lunch
      // and two catch an evening flight: one line reading "5 leave" summarises
      // that into something nobody can act on. Only worth splitting when the
      // modes actually differ, otherwise it is the same row with a longer name.
      if (g.key === "leavingToday" || g.key === "arrivingToday") {
        const leaving = g.key === "leavingToday";
        const byMode = groupByTravelMode(
          people,
          travelMode,
          leaving ? "departsAt" : "arrivesAt",
        );
        if (byMode.length > 1) {
          return byMode.map((m) => ({
            id: `${leaving ? "leaving" : "arriving"}:${m.mode}`,
            key: g.key,
            label: (leaving ? LEAVING_LABEL : ARRIVING_LABEL)[m.mode],
            icon: TRAVEL_ICON[m.mode],
            tone: g.tone,
            people: m.people,
          }));
        }
      }

      return [{ id: g.key, key: g.key, label: g.label, icon: g.icon, tone: g.tone, people }];
    },
  );
  if (groups.length === 0) return null;

  const colour = (tone: string) =>
    tone === "here" ? t.color.going : tone === "moving" ? t.color.accent : t.color.textMuted;

  return (
    <>
      <Card style={{ gap: space.md }}>
        {groups.map((g) => {
          const people = g.people;
          const names = people.map((p) => describe(p, g.key, tz)).join(", ");
          const budget = valueWidth > 0 ? Math.floor(valueWidth / CHAR_WIDTH) : 0;
          const fits = budget > 0 && names.length <= budget;

          return (
            <View
              key={g.id}
              style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
            >
              <Ionicons
                name={
                  // Coming and going take a travel icon; being here or not is
                  // not a mode of transport. A split departure row already
                  // carries its own mode's icon, so only the unsplit rows need
                  // the shared-mode fallback.
                  g.key === "arrivingToday" || g.key === "leavingToday"
                    ? TRAVEL_ICON[
                        sharedTravelMode(
                          people,
                          travelMode,
                          g.key === "leavingToday" ? "out" : "in",
                        )
                      ]
                    : g.icon
                }
                size={17}
                color={colour(g.tone)}
              />
              <Text style={{ ...type.caption, color: t.color.textMuted, width: 104 }}>
                {g.label}
              </Text>

              <View
                style={{ flex: 1 }}
                onLayout={(e) => setValueWidth(e.nativeEvent.layout.width)}
              >
                {fits ? (
                  <Text numberOfLines={1} style={{ ...type.caption, color: t.color.text }}>
                    {names}
                  </Text>
                ) : (
                  <Pressable
                    onPress={() => setShowing({ label: g.label, people, key: g.key })}
                    accessibilityRole="button"
                    accessibilityLabel={`${g.label}: ${people.length}. Show who.`}
                    style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
                  >
                    <Text
                      style={{ ...type.caption, fontWeight: "600", color: t.color.accent }}
                    >
                      {people.length} {people.length === 1 ? "person" : "people"}
                    </Text>
                    <Ionicons name="chevron-forward" size={13} color={t.color.accent} />
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </Card>

      <Modal
        visible={showing !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setShowing(null)}
      >
        <Pressable
          onPress={() => setShowing(null)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.4)",
            justifyContent: "center",
            padding: space.xl,
          }}
        >
          <View
            style={{
              backgroundColor: t.color.surface,
              borderRadius: radius.lg,
              padding: space.lg,
              gap: space.md,
              maxHeight: "70%",
            }}
          >
            <Text style={{ ...type.heading, color: t.color.text }}>
              {showing?.label}
            </Text>
            <ScrollView contentContainerStyle={{ gap: space.sm }}>
              {showing?.people.map((p) => (
                <View
                  key={p.userId}
                  style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
                >
                  {/* Per-person detail belongs here, where a mixed group can
                      show each person's own way of getting there. */}
                  {showing.key === "arrivingToday" || showing.key === "leavingToday" ? (
                    <Ionicons
                      name={
                        TRAVEL_ICON[
                          travelModeFor(
                            p,
                            showing.key === "leavingToday" ? "out" : "in",
                            travelMode,
                          )
                        ]
                      }
                      size={17}
                      color={t.color.textMuted}
                    />
                  ) : null}
                  <Text style={{ ...type.body, color: t.color.text }}>
                    {describe(p, showing.key, tz)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
