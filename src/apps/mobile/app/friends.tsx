import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { PersonRowItem } from "@/components/PersonRowItem";
import { Card, EmptyState, Muted } from "@/components/ui";
import type { FriendGrants, PersonRow } from "@/db/repo";
import {
  acceptFriendRequest,
  listFriends,
  removeFriend,
  setFriendGrants,
} from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * What each level discloses, in the second person, because the question a person
 * is actually asking is "what does this let them see of me?" (§7.4).
 */
const GRANTS: { value: FriendGrants; label: string; detail: string }[] = [
  {
    value: "none",
    label: "Friends only",
    detail: "They can't see anything about your time.",
  },
  {
    value: "busy",
    label: "When you're free",
    detail: "They see busy and free periods. No titles, no places, no who.",
  },
  {
    value: "full",
    label: "Your full calendar",
    detail: "They see everything: titles, times and locations.",
  },
];

const grantLabel = (g: FriendGrants | null): string =>
  GRANTS.find((x) => x.value === (g ?? "none"))?.label ?? "Friends only";

/**
 * Manage friends (§7.3).
 *
 * Requests first, because they are waiting on an answer; the roster second.
 * Per-friend visibility (§7.4) is deliberately absent: it is meaningless until
 * free/busy exists, and a toggle that does nothing would pollute any read of
 * whether this screen works.
 */
export default function FriendsScreen() {
  const t = useTheme();

  const incoming = useQuery("friends:in", () => listFriends("pending_in"));
  const outgoing = useQuery("friends:out", () => listFriends("pending_out"));
  const accepted = useQuery("friends:accepted", () => listFriends("accepted"));

  const empty =
    incoming.length === 0 && outgoing.length === 0 && accepted.length === 0;

  if (empty) {
    return (
      <>
        <Stack.Screen options={{ title: "Friends", presentation: "modal" }} />
        <EmptyState
          title="No friends yet"
          body="Search for someone, or add one of the people you've already planned with."
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Friends", presentation: "modal" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        {incoming.length > 0 ? (
          <Section title="Wants to be friends">
            {incoming.map((p) => (
              <PersonRowItem
                key={p.user_id}
                person={p}
                actions={[
                  {
                    label: "Accept",
                    tone: "primary",
                    onPress: () => acceptFriendRequest(p.user_id),
                  },
                  { label: "Ignore", onPress: () => removeFriend(p.user_id) },
                ]}
              />
            ))}
          </Section>
        ) : null}

        {outgoing.length > 0 ? (
          <Section title="Requested">
            {outgoing.map((p) => (
              <PersonRowItem
                key={p.user_id}
                person={p}
                context="waiting for them"
                actions={[
                  { label: "Cancel", onPress: () => removeFriend(p.user_id) },
                ]}
              />
            ))}
          </Section>
        ) : null}

        <Section title={`Friends · ${accepted.length}`}>
          {accepted.length === 0 ? (
            <Muted>Nobody yet.</Muted>
          ) : (
            accepted.map((p) => <FriendRow key={p.user_id} person={p} />)
          )}
        </Section>

        <Muted>
          Each line says what that person can see of you. It has no effect until
          availability sharing arrives, but what you choose is kept.
        </Muted>
      </ScrollView>
    </>
  );
}

/**
 * A friend, with what they can see of you always on the row rather than behind a
 * settings screen — one of §7.4's conditions, and the cheapest of them to honour.
 */
function FriendRow({ person }: { person: PersonRow }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current: FriendGrants = person.grants ?? "none";

  const choose = (next: FriendGrants) => {
    // Escalating to full calendar access is the highest-risk permission in the
    // product (§7.4). It does not happen on a single tap.
    if (next === "full" && current !== "full") {
      Alert.alert(
        `Show ${person.display_name} your full calendar?`,
        "They'll see the titles, times and locations of everything in your calendar. You can turn this off at any time, and they won't be told.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Show full calendar",
            style: "destructive",
            onPress: () => {
              setFriendGrants(person.user_id, next);
              setOpen(false);
            },
          },
        ],
      );
      return;
    }

    setFriendGrants(person.user_id, next);
    setOpen(false);
  };

  return (
    <View style={{ gap: space.sm }}>
      <PersonRowItem
        person={person}
        context={grantLabel(current)}
        contextTone={current === "none" ? "muted" : "notice"}
        actions={[
          { label: open ? "Done" : "Change", onPress: () => setOpen(!open) },
          { label: "Remove", onPress: () => removeFriend(person.user_id) },
        ]}
      />

      {open ? (
        <View
          style={{
            gap: space.xs,
            padding: space.sm,
            borderRadius: radius.sm,
            backgroundColor: t.color.surfaceAlt,
          }}
        >
          {GRANTS.map((g) => {
            const selected = g.value === current;
            return (
              <Pressable
                key={g.value}
                onPress={() => choose(g.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  flexDirection: "row",
                  gap: space.sm,
                  padding: space.sm,
                  borderRadius: radius.sm,
                  backgroundColor: selected ? t.color.surface : "transparent",
                }}
              >
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={17}
                  color={selected ? t.color.accent : t.color.textMuted}
                  style={{ marginTop: 1 }}
                />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ ...type.caption, fontWeight: "600", color: t.color.text }}>
                    {g.label}
                  </Text>
                  <Text style={{ ...type.caption, color: t.color.textMuted }}>
                    {g.detail}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ ...type.label, color: t.color.textMuted }}>{title}</Text>
      <Card style={{ gap: space.lg }}>{children}</Card>
    </View>
  );
}
