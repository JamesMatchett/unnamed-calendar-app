import { Ionicons } from "@expo/vector-icons";
import type { Window } from "@calder/core";
import { canSeeFreeBusy, findMutualSlots, zonedWallToUtc } from "@calder/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Segmented } from "@/components/form";
import { Card, EmptyState, Group, Muted } from "@/components/ui";
import { busyBetween, friendProfile, sharedCalendars } from "@/db/repo";
import { CURRENT_USER_ID, OWN_PLANS_ID } from "@/db/seed";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/** How far ahead to look. Two weeks is about as far as anyone plans a coffee. */
const HORIZON_DAYS = 14;

type WhenKind = "evenings" | "daytime" | "weekend";

/**
 * The hours each shape of catch-up can happen in, as local wall clock.
 *
 * These are opinions, and they are the point: "when are we both free" answered
 * across all 168 hours of a week returns Tuesday at 04:00, which is technically
 * true and useless. A drink is an evening, a coffee is daytime, a proper day out
 * is the weekend.
 */
const KINDS: {
  value: WhenKind;
  label: string;
  from: string;
  to: string;
  days?: (dow: number) => boolean;
}[] = [
  { value: "evenings", label: "Evenings", from: "18:00", to: "23:00" },
  {
    value: "daytime",
    label: "Daytime",
    from: "09:00",
    to: "18:00",
  },
  {
    value: "weekend",
    label: "Weekend",
    from: "10:00",
    to: "22:00",
    // 0 is Sunday in JS, 6 is Saturday.
    days: (dow) => dow === 0 || dow === 6,
  },
];

const LENGTHS = [
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "An evening" },
];

/**
 * When are we both free? (§8.1)
 *
 * The answer to arranging anything is an intersection nobody can hold in their
 * head — my evenings, minus yours, minus the two things I forgot about — so the
 * app computes it rather than asking two people to negotiate it by message.
 *
 * The rules live in @calder/core and are tested there; this screen's job is to
 * turn "evenings, two hours, the next fortnight" into windows, hand them over,
 * and make each answer one tap from being a real event.
 */
export default function CatchUpScreen() {
  const t = useTheme();
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [kind, setKind] = useState<WhenKind>("evenings");
  const [minutes, setMinutes] = useState("120");

  const person = useQuery(`person:${userId}`, () => friendProfile(userId));
  const shared = useQuery(`shared:${userId}`, () => sharedCalendars(userId));

  // The zone to think in: one you actually share, falling back to this phone's.
  const tz =
    shared[0]?.default_tz ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "Europe/London";

  const from = useMemo(() => new Date(), []);
  const to = useMemo(
    () => new Date(from.getTime() + HORIZON_DAYS * 86_400_000),
    [from],
  );

  const busy = useQuery(
    `busy:${userId}:${from.toISOString().slice(0, 10)}`,
    () => busyBetween([CURRENT_USER_ID, userId], from.toISOString(), to.toISOString()),
  );

  const shape = KINDS.find((k) => k.value === kind) ?? KINDS[0]!;

  const slots = useMemo(() => {
    const windows: Window[] = [];
    const cursor = new Date(from);

    for (let i = 0; i < HORIZON_DAYS; i++) {
      const day = cursor.toISOString().slice(0, 10);
      if (!shape.days || shape.days(cursor.getUTCDay())) {
        const start = zonedWallToUtc(`${day}T${shape.from}:00`, tz);
        const end = zonedWallToUtc(`${day}T${shape.to}:00`, tz);
        // Today is half gone by lunchtime: an evening that has already started
        // is not a suggestion, so the window opens no earlier than now.
        windows.push({
          day,
          start: start < from.toISOString() ? from.toISOString() : start,
          end,
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return findMutualSlots(
      windows.filter((w) => w.start < w.end),
      busy,
      { durationMins: Number(minutes), limit: 8, perDay: 1 },
    );
  }, [busy, from, minutes, shape, tz]);

  if (!person) {
    return (
      <>
        <Stack.Screen options={{ title: "Catch up" }} />
        <EmptyState title="Not found" body="This person is no longer listed." />
      </>
    );
  }

  const first = person.display_name.split(" ")[0];

  if (!canSeeFreeBusy(person.shares)) {
    return (
      <>
        <Stack.Screen options={{ title: `Catch up with ${first}` }} />
        <EmptyState
          title={`${first} hasn't shared their time`}
          body="Finding a time needs both calendars. Ask them to show you when they're free, or pick a time yourself and invite them."
        />
      </>
    );
  }

  /**
   * A suggestion is worth nothing until it is a plan, so each one goes straight
   * into the add-event form with the time already filled in.
   *
   * A private calendar you share is the natural home: a catch-up between two
   * people belongs in the calendar that is about those two people, not on the
   * group trip. Without one it becomes an invitation instead, from your own
   * plans to theirs, which needs no calendar in common at all.
   */
  const target = shared.find((c) => c.is_private === 1) ?? null;

  return (
    <>
      <Stack.Screen options={{ title: `Catch up with ${first}` }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Muted>
          Times in the next fortnight when neither of you has anything on. Times
          are in {tz}.
        </Muted>

        <View style={{ gap: space.sm }}>
          <Segmented
            value={kind}
            onChange={(v) => setKind(v as WhenKind)}
            options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
          />
          <Segmented value={minutes} onChange={setMinutes} options={LENGTHS} />
        </View>

        {slots.length === 0 ? (
          <Card style={{ gap: space.sm }}>
            <Text style={{ ...type.body, color: t.color.text }}>
              Nothing that long is free for both of you.
            </Text>
            <Muted>
              Try a shorter catch-up or a different part of the day. What you can
              see of {first} is only what they have chosen to share.
            </Muted>
          </Card>
        ) : (
          <Group>
            {slots.map((slot) => (
              <Pressable
                key={slot.start}
                onPress={() =>
                  router.push({
                    pathname: "/calendar/[calendarId]/event/new",
                    params: target
                      ? {
                          calendarId: target.calendar_id,
                          on: slot.day,
                          at: clock(slot.start, tz),
                          with: first,
                        }
                      : {
                          calendarId: OWN_PLANS_ID,
                          on: slot.day,
                          at: clock(slot.start, tz),
                          with: first,
                          invite: userId,
                        },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${longDay(slot.day)} at ${clock(slot.start, tz)}, make this an event`}
                style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.body, fontSize: 15, color: t.color.text }}>
                    {longDay(slot.day)}
                  </Text>
                  <Muted>
                    {clock(slot.start, tz)} to {clock(slot.end, tz)}
                  </Muted>
                </View>
                <Ionicons name="add-circle-outline" size={20} color={t.color.accent} />
              </Pressable>
            ))}
          </Group>
        )}

        {slots.length > 0 ? (
          <Muted>
            {target
              ? `Picking one opens a new event in ${target.name}, with the time already set.`
              : `Picking one drafts an invitation to ${first}, with the time already set. It goes in your own plans and, if they say yes, in theirs.`}
          </Muted>
        ) : null}

        <View
          style={{
            padding: space.lg,
            borderRadius: radius.md,
            backgroundColor: t.color.surfaceAlt,
            gap: space.xs,
          }}
        >
          <Text style={{ ...type.caption, color: t.color.textMuted }}>
            Free means nothing you have said yes to, and nothing in your own
            calendars. A maybe is not busy, on purpose: an undecided evening is
            exactly the kind a catch-up can win.
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const clock = (instant: string, tz: string): string =>
  new Date(instant).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  });

const longDay = (day: string): string =>
  new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
