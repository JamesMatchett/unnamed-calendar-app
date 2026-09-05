import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { PersonRowItem } from "@/components/PersonRowItem";
import { SearchBar } from "@/components/SearchBar";
import { Card, Muted } from "@/components/ui";
import {
  inviteUser,
  listFriends,
  listMembers,
  listSentInvites,
  searchPeople,
} from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Asking people to a calendar.
 *
 * Friends first, and without being searched for: the people you would invite
 * to a trip are overwhelmingly the people you already know here, and making
 * somebody type a name they have already told us is a search box doing the work
 * of a list. Search is underneath for everyone else, because the second half of
 * the truth is that a trip usually has one person on it you have never planned
 * with before.
 *
 * Anybody already in, or already asked, stays in the list rather than being
 * filtered out of it. A name that vanishes when you invite it reads as a
 * failure, and "Invited" beside a face is the receipt.
 */
export function InvitePeopleDialog({
  calendarId,
  calendarName,
  visible,
  onClose,
}: {
  calendarId: string;
  calendarName: string;
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const friends = useQuery("friends:accepted", () => listFriends("accepted"));
  const members = useQuery(`members:${calendarId}`, () => listMembers(calendarId));
  const asked = useQuery(`sent:${calendarId}`, () => listSentInvites(calendarId));
  const results = useQuery(`search:${query}`, () => searchPeople(query));

  const searching = query.trim().length > 0;
  const inCalendar = new Set(members.map((m) => m.user_id));
  const alreadyAsked = new Set(asked.map((a) => a.user_id));

  const state = (userId: string) =>
    inCalendar.has(userId) ? "in" : alreadyAsked.has(userId) ? "asked" : "none";

  const row = (person: Parameters<typeof PersonRowItem>[0]["person"]) => {
    const where = state(person.user_id);
    return (
      <PersonRowItem
        key={person.user_id}
        person={person}
        context={where === "in" ? "already here" : where === "asked" ? "invited" : undefined}
        contextTone={where === "asked" ? "notice" : "muted"}
        onPress={() =>
          router.push({
            pathname: "/person/[userId]",
            params: { userId: person.user_id },
          })
        }
        actions={
          where === "none"
            ? [
                {
                  label: "Invite",
                  tone: "primary" as const,
                  onPress: () => inviteUser(calendarId, person.user_id),
                },
              ]
            : []
        }
      />
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}
      />
      <View
        style={{
          backgroundColor: t.color.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingBottom: space.xxl,
          maxHeight: "85%",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: space.lg,
          }}
        >
          <Text style={{ ...type.heading, color: t.color.text }}>Invite people</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={{ ...type.label, color: t.color.accent }}>Done</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search &handle, name or email"
          />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {searching ? (
            results.length === 0 ? (
              <Card>
                <Muted>Nobody matching "{query.trim()}".</Muted>
              </Card>
            ) : (
              <Card style={{ gap: space.lg }}>{results.map(row)}</Card>
            )
          ) : (
            <>
              <View style={{ gap: space.sm }}>
                <Text style={{ ...type.label, color: t.color.textMuted }}>
                  Your friends
                </Text>
                {friends.length === 0 ? (
                  <Card>
                    <Muted>
                      No friends yet. Search above for anyone by their &handle,
                      or share a link.
                    </Muted>
                  </Card>
                ) : (
                  <Card style={{ gap: space.lg }}>{friends.map(row)}</Card>
                )}
              </View>

              {/* The link is the way to reach somebody who is not here at all,
                  which no amount of searching a directory can fix. */}
              <Pressable
                onPress={() => {
                  onClose();
                  router.push({
                    pathname: "/calendar/[calendarId]/invite",
                    params: { calendarId },
                  });
                }}
                accessibilityRole="button"
                style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
              >
                <Ionicons name="link-outline" size={17} color={t.color.accent} />
                <Text style={{ ...type.label, color: t.color.accent }}>
                  Share a link to {calendarName} instead
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
