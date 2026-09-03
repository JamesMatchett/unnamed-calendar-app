import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";

import { PersonRowItem } from "@/components/PersonRowItem";
import { SearchBar } from "@/components/SearchBar";
import { Card, EmptyState, Muted } from "@/components/ui";
import {
  acceptFriendRequest,
  answerInvite,
  listPendingInvites,
  listPeopleNotifications,
  listSuggestions,
  markSurfaceRead,
  searchPeople,
  sendFriendRequest,
} from "@/db/repo";
import { formatDateRange } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * People: a destination, not a feed (§3.5).
 *
 * Invites sit at the top because they are waiting on an answer. Connections are
 * DERIVED from shared calendar membership (§7.2) — there is no friends graph,
 * no requests to send and nothing to search, because the graph already exists
 * implicitly in who you have planned with.
 */
export default function PeopleScreen() {
  const t = useTheme();
  const router = useRouter();

  const [query, setQuery] = useState("");

  const invites = useQuery("invites", () => listPendingInvites());
  const suggestions = useQuery("suggestions", () => listSuggestions());
  const history = useQuery("people-notifs", () => listPeopleNotifications());
  const results = useQuery(`search:${query}`, () => searchPeople(query));
  const searching = query.trim().length > 0;

  // Opening the surface is the acknowledgement. Invites are unaffected: they
  // stay live until answered, which is the whole reason they are not news.
  useEffect(() => {
    markSurfaceRead("people");
  }, []);

  const answered = history.filter((n) => n.kind !== "invite_pending");

  /**
   * The OS share sheet rather than an in-app invite form: the person being
   * invited is not in Cal&der, so the only way to reach them is whatever the two of
   * them already use. Anything we built here would be a worse WhatsApp.
   */
  const inviteToApp = async () => {
    try {
      await Share.share({
        message:
          "Come and plan things with me on Cal&der: https://calder.app/get",
      });
    } catch {
      // Dismissing the sheet is not a failure, and there is nothing useful to
      // say about one that will not open.
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "People",
          presentation: "modal",
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/settings")}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Ionicons name="settings-outline" size={22} color={t.color.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Waiting for you
          </Text>

          {invites.length === 0 ? (
            <Card>
              <Muted>No invitations right now.</Muted>
            </Card>
          ) : (
            invites.map((inv) => {
              const range = formatDateRange(
                inv.start_date ?? undefined,
                inv.end_date ?? undefined,
              );
              return (
                <Card key={inv.calendar_id} style={{ gap: space.md }}>
                  <View style={{ gap: 2 }}>
                    <Text style={{ ...type.heading, color: t.color.text }}>
                      {inv.calendar_name}
                    </Text>
                    <Muted>
                      {inv.invited_by_name} invited you ·{" "}
                      {range ?? "Ongoing"} · {inv.event_count} events ·{" "}
                      {inv.member_count} people
                    </Muted>
                  </View>

                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <Pressable
                      onPress={() => answerInvite(inv.calendar_id, true)}
                      style={{
                        flex: 1,
                        alignItems: "center",
                        paddingVertical: space.md,
                        borderRadius: radius.pill,
                        backgroundColor: t.color.accent,
                      }}
                    >
                      <Text style={{ ...type.label, color: "#fff" }}>Join</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => answerInvite(inv.calendar_id, false)}
                      style={{
                        paddingHorizontal: space.xl,
                        paddingVertical: space.md,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: t.color.border,
                      }}
                    >
                      <Text style={{ ...type.label, color: t.color.textMuted }}>
                        Decline
                      </Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })
          )}
        </View>

        <View style={{ gap: space.sm }}>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search &handle, name or email"
          />

          {/* Search only finds people who are already here, so a search that
              fails is the moment someone learns their friend is not. Offering
              the invite right there turns a dead end into the next step, and
              keeping it visible the rest of the time means nobody has to search
              for a person they know is missing to find it. */}
          <Pressable
            onPress={() => void inviteToApp()}
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingVertical: space.xs,
            }}
          >
            <Ionicons name="person-add-outline" size={15} color={t.color.accent} />
            <Text style={{ ...type.caption, color: t.color.accent }}>
              Invite someone to the app
            </Text>
          </Pressable>

          {searching ? (
            results.length === 0 ? (
              <Card style={{ gap: space.sm }}>
                <Muted>Nobody matching "{query.trim()}".</Muted>
                <Pressable
                  onPress={() => void inviteToApp()}
                  accessibilityRole="button"
                >
                  <Text style={{ ...type.label, color: t.color.accent }}>
                    Invite them to Cal&der
                  </Text>
                </Pressable>
              </Card>
            ) : (
              <Card style={{ gap: space.lg }}>
                {results.map((p) => (
                  <PersonRowItem
                    key={p.user_id}
                    person={p}
                    actions={
                      p.status === "pending_in"
                        ? [
                            {
                              label: "Accept",
                              tone: "primary" as const,
                              onPress: () => acceptFriendRequest(p.user_id),
                            },
                          ]
                        : p.status === null
                          ? [
                              {
                                label: "Add friend",
                                tone: "primary" as const,
                                onPress: () => sendFriendRequest(p.user_id),
                              },
                            ]
                          : []
                    }
                  />
                ))}
              </Card>
            )
          ) : null}
        </View>

        {!searching ? (
          <View style={{ gap: space.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ ...type.label, color: t.color.textMuted }}>
                People you've planned with
              </Text>
              <Pressable
                onPress={() => router.push("/friends")}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={{ ...type.label, color: t.color.accent }}>
                  Manage friends
                </Text>
              </Pressable>
            </View>

            {suggestions.length === 0 ? (
              <EmptyState
                title="Nobody to suggest"
                body="People you share a calendar with show up here, ready to add."
                actionLabel="Go to calendars"
                // People is a modal, so pushing would stack the calendars
                // screen on top of it. Dismiss first, then switch tab.
                onAction={() => {
                  router.dismissAll();
                  router.navigate("/calendars");
                }}
              />
            ) : (
              <Card style={{ gap: space.lg }}>
                {suggestions.map((p) => (
                  <PersonRowItem
                    key={p.user_id}
                    person={p}
                    context={describeOverlap(p.shared_calendars, p.mutual_events)}
                    actions={[
                      {
                        label: "Add friend",
                        tone: "primary" as const,
                        onPress: () => sendFriendRequest(p.user_id),
                      },
                    ]}
                  />
                ))}
              </Card>
            )}
            <Muted>
              Suggested from calendars you share and events you've both been to.
            </Muted>
          </View>
        ) : null}

        {answered.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>Earlier</Text>
            <Card style={{ gap: space.md }}>
              {answered.map((n) => (
                <View
                  key={n.notification_id}
                  style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}
                >
                  <Ionicons
                    name="person-add-outline"
                    size={17}
                    color={t.color.textMuted}
                  />
                  <Text style={{ ...type.caption, color: t.color.text, flex: 1 }}>
                    {n.actor_name} · {n.calendar_name}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

/**
 * Why this person is being suggested. Shared calendars alone is a weak signal —
 * you can be in a group calendar with someone you have never actually met — so
 * events you have both been Going to leads when there are any.
 */
function describeOverlap(sharedCalendars: number, mutualEvents: number): string {
  if (mutualEvents > 0) {
    return `${mutualEvents} ${mutualEvents === 1 ? "event" : "events"} together`;
  }
  return `${sharedCalendars} shared ${sharedCalendars === 1 ? "calendar" : "calendars"}`;
}
