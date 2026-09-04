import { Ionicons } from "@expo/vector-icons";
import type { SchedulingMode, SlotResponse } from "@calder/core";
import { canProposeSlot, isClearWinner, rankSlots } from "@calder/core";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { MemberRow, SlotRow, SlotVoteRow } from "@/db/repo";
import { chooseSlot, removeSlot, setSlotVote } from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { formatClock, formatDayShort } from "@/lib/format";
import { radius, space, type, useTheme } from "@/theme";

import { Card, Muted } from "./ui";

const OPTIONS: { value: SlotResponse; label: string }[] = [
  { value: "yes", label: "Can make it" },
  { value: "if_need_be", label: "If need be" },
  { value: "no", label: "Can't" },
];

/**
 * Choosing a date together (§8.1).
 *
 * The list is ordered by how well each slot suits the group rather than by time,
 * because the question on this screen is "which one" and not "what is next".
 * Every slot shows who said what by name: a poll that only shows totals turns
 * "Priya can't do Thursday" into "one person can't", which is the fact the
 * organiser actually needs.
 */
export function SlotPoll({
  eventId,
  mode,
  slots,
  votes,
  members,
  canDecide,
  isEventOwner,
  myRole,
  onAddSlot,
}: {
  eventId: string;
  mode: SchedulingMode;
  slots: readonly SlotRow[];
  votes: readonly SlotVoteRow[];
  members: readonly MemberRow[];
  /** Owners and the event's author settle it. */
  canDecide: boolean;
  isEventOwner: boolean;
  myRole: "owner" | "member" | null;
  onAddSlot: () => void;
}) {
  const t = useTheme();
  const [expanded, setExpanded] = useState<string | null>(null);

  const ranked = rankSlots(
    slots.map((s) => ({ slotId: s.slot_id, startUtc: s.start_utc })),
    votes.map((v) => ({
      slotId: v.slot_id,
      userId: v.user_id,
      response: v.response,
    })),
    members.length,
  );

  const byId = new Map(slots.map((s) => [s.slot_id, s]));
  const leader = isClearWinner(ranked) ? ranked[0] : null;

  const mayPropose = canProposeSlot({ mode, role: myRole, isEventOwner });

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Ionicons name="help-circle-outline" size={17} color={t.color.accent} />
        <Text style={{ ...type.label, color: t.color.text, flex: 1 }}>
          {mode === "open" ? "When suits everyone?" : "Pick a time"}
        </Text>
        <Muted>
          {votes.length === 0
            ? "No answers yet"
            : `${answeredCount(votes)} of ${members.length} answered`}
        </Muted>
      </View>

      {slots.length === 0 ? (
        <Card>
          <Muted>
            {mayPropose
              ? "No times yet. Add one below and people can say whether it works."
              : "The organiser has not put any times up yet."}
          </Muted>
        </Card>
      ) : null}

      {ranked.map((r) => {
        const slot = byId.get(r.slotId);
        if (!slot) return null;

        const mine = votes.find(
          (v) => v.slot_id === slot.slot_id && v.user_id === CURRENT_USER_ID,
        );
        const isLeader = leader?.slotId === slot.slot_id;
        const open = expanded === slot.slot_id;

        return (
          <Card
            key={slot.slot_id}
            style={{
              gap: space.sm,
              borderColor: isLeader ? t.color.going : t.color.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.label, fontSize: 15, color: t.color.text }}>
                  {formatDayShort(slot.local_wall.slice(0, 10), slot.tz)}
                  {slot.precision === "datetime"
                    ? ` · ${formatClock(slot.start_utc, slot.tz)}`
                    : " · All day"}
                </Text>
                <Muted>
                  {slot.proposed_by === CURRENT_USER_ID
                    ? "You suggested this"
                    : `${slot.proposed_by_name} suggested this`}
                </Muted>
              </View>

              {isLeader ? (
                <View
                  style={{
                    paddingHorizontal: space.sm,
                    paddingVertical: 2,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: t.color.going,
                  }}
                >
                  <Text
                    style={{ ...type.caption, fontSize: 11, color: t.color.going }}
                  >
                    Best so far
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Counts first, names on a tap. The numbers answer "is this the
                one"; the names answer "who am I about to strand", which is a
                question you ask about one slot, not all of them at once. */}
            <Pressable
              onPress={() => setExpanded(open ? null : slot.slot_id)}
              accessibilityRole="button"
              accessibilityLabel={`${r.yes} can make it, ${r.ifNeedBe} if need be, ${r.no} cannot. Show who.`}
              style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
            >
              <Count n={r.yes} colour={t.color.going} />
              <Count n={r.ifNeedBe} colour={t.color.maybe} />
              <Count n={r.no} colour={t.color.notGoing} />
              {r.noResponse > 0 ? (
                <Count n={r.noResponse} colour={t.color.textMuted} />
              ) : null}
              <Ionicons
                name={open ? "chevron-up" : "chevron-down"}
                size={14}
                color={t.color.textMuted}
                style={{ marginLeft: "auto" }}
              />
            </Pressable>

            {open ? (
              <View style={{ gap: 2 }}>
                {OPTIONS.map((o) => {
                  const names = members
                    .filter((m) =>
                      votes.some(
                        (v) =>
                          v.slot_id === slot.slot_id &&
                          v.user_id === m.user_id &&
                          v.response === o.value,
                      ),
                    )
                    .map((m) => m.display_name);
                  if (names.length === 0) return null;

                  return (
                    <Text
                      key={o.value}
                      style={{ ...type.caption, color: t.color.textMuted }}
                    >
                      <Text style={{ color: colourFor(o.value, t) }}>
                        {o.label}:{" "}
                      </Text>
                      {names.join(", ")}
                    </Text>
                  );
                })}

                {r.noResponse > 0 ? (
                  <Text style={{ ...type.caption, color: t.color.textMuted }}>
                    Not answered:{" "}
                    {members
                      .filter(
                        (m) =>
                          !votes.some(
                            (v) =>
                              v.slot_id === slot.slot_id && v.user_id === m.user_id,
                          ),
                      )
                      .map((m) => m.display_name)
                      .join(", ")}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={{ flexDirection: "row", gap: space.xs }}>
              {OPTIONS.map((o) => {
                const selected = mine?.response === o.value;
                return (
                  <Pressable
                    key={o.value}
                    // Tapping your own answer clears it: "not decided" is a real
                    // state and there has to be a way back to it.
                    onPress={() =>
                      setSlotVote(eventId, slot.slot_id, selected ? null : o.value)
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      paddingVertical: 5,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: selected ? colourFor(o.value, t) : t.color.border,
                      backgroundColor: selected
                        ? colourFor(o.value, t)
                        : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        ...type.caption,
                        fontWeight: selected ? "700" : "500",
                        color: selected ? "#fff" : t.color.textMuted,
                      }}
                    >
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {canDecide ? (
              <View style={{ flexDirection: "row", gap: space.lg }}>
                <Pressable
                  onPress={() => chooseSlot(eventId, slot.slot_id)}
                  accessibilityRole="button"
                >
                  <Text style={{ ...type.label, color: t.color.accent }}>
                    Go with this one
                  </Text>
                </Pressable>
                {slots.length > 1 ? (
                  <Pressable
                    onPress={() => removeSlot(slot.slot_id)}
                    accessibilityRole="button"
                  >
                    <Text style={{ ...type.caption, color: t.color.textMuted }}>
                      Remove
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}

      {mayPropose ? (
        <Pressable onPress={onAddSlot} accessibilityRole="button">
          <Text style={{ ...type.label, color: t.color.accent }}>
            {mode === "open" ? "Suggest another time" : "Add a time"}
          </Text>
        </Pressable>
      ) : null}

      {canDecide && slots.length > 0 ? (
        <Muted>
          Choosing a time sets the event and marks everyone who said yes as going.
        </Muted>
      ) : null}
    </View>
  );
}

function Count({ n, colour }: { n: number; colour: string }) {
  if (n === 0) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <View
        style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colour }}
      />
      <Text style={{ ...type.caption, color: colour, fontWeight: "700" }}>{n}</Text>
    </View>
  );
}

const colourFor = (
  r: SlotResponse,
  t: ReturnType<typeof useTheme>,
): string =>
  r === "yes" ? t.color.going : r === "if_need_be" ? t.color.maybe : t.color.notGoing;

/** People who have answered at least one slot. */
const answeredCount = (votes: readonly SlotVoteRow[]): number =>
  new Set(votes.map((v) => v.user_id)).size;
