import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { PersonRowItem } from "@/components/PersonRowItem";
import { SearchBar } from "@/components/SearchBar";
import { Card, EmptyState, Muted } from "@/components/ui";
import type { FriendGrants } from "@/db/repo";
import {
  acceptFriendRequest,
  answerEventInvite,
  answerInvite,
  listEventInvitesForMe,
  listFriends,
  listPendingInvites,
  listPeopleNotifications,
  listSuggestions,
  markSurfaceRead,
  removeFriend,
  searchPeople,
  sendFriendRequest,
} from "@/db/repo";
import { formatDateRange, formatEventTime } from "@/lib/format";
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
  const eventInvites = useQuery("event-invites", () => listEventInvitesForMe());
  const incoming = useQuery("friends:in", () => listFriends("pending_in"));
  const outgoing = useQuery("friends:out", () => listFriends("pending_out"));
  const friends = useQuery("friends:accepted", () => listFriends("accepted"));
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

  const openPerson = (userId: string) =>
    router.push({ pathname: "/person/[userId]", params: { userId } });

  /**
   * Your own code, which carries the share sheet with it.
   *
   * This used to open the sheet directly. That covers somebody you are
   * messaging and misses the commonest case entirely: two people stood next to
   * each other, where the natural move is to hold up a phone. The code screen
   * does both, and putting the sheet one tap further away costs the remote case
   * almost nothing.
   */
  const inviteToApp = () => router.push("/connect");

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

          {/* One person asking you to one thing. Above the calendar invites
              because it is dated: a coffee on Thursday goes stale in a way a
              trip in June does not. */}
          {eventInvites.map((inv) => (
            <Card key={inv.invite_id} style={{ gap: space.md }}>
              <View style={{ gap: 2 }}>
                <Text style={{ ...type.heading, color: t.color.text }}>
                  {inv.title}
                </Text>
                <Muted>
                  {inv.from_name} asked you ·{" "}
                  {formatEventTime({
                    startUtc: inv.start_utc,
                    endUtc: inv.end_utc ?? undefined,
                    tz: inv.tz,
                    localWall: inv.local_wall,
                    precision: inv.precision,
                  })}
                  {inv.location_name ? ` · ${inv.location_name}` : ""}
                </Muted>
              </View>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Pressable
                  onPress={() => answerEventInvite(inv.invite_id, true)}
                  accessibilityRole="button"
                  style={{
                    flex: 1,
                    alignItems: "center",
                    paddingVertical: space.md,
                    borderRadius: radius.pill,
                    backgroundColor: t.color.accentFill,
                  }}
                >
                  <Text style={{ ...type.label, color: t.color.onAccent }}>
                    I'm in
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => answerEventInvite(inv.invite_id, false)}
                  accessibilityRole="button"
                  style={{
                    paddingHorizontal: space.xl,
                    paddingVertical: space.md,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: t.color.border,
                  }}
                >
                  <Text style={{ ...type.label, color: t.color.textMuted }}>
                    Can't
                  </Text>
                </Pressable>
              </View>
              <Muted>Saying yes puts it in your own plans.</Muted>
            </Card>
          ))}

          {invites.length === 0 && eventInvites.length === 0 ? (
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
                        backgroundColor: t.color.accentFill,
                      }}
                    >
                      <Text style={{ ...type.label, color: t.color.onAccent }}>Join</Text>
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
            onPress={inviteToApp}
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
              Show my code, or invite someone
            </Text>
          </Pressable>

          {searching ? (
            results.length === 0 ? (
              <Card style={{ gap: space.sm }}>
                <Muted>Nobody matching "{query.trim()}".</Muted>
                <Pressable
                  onPress={inviteToApp}
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
                    onPress={() => openPerson(p.user_id)}
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

        {/* Your friends, on the screen called People.
            They used to live behind a "Manage friends" link, which meant the
            tab named after the people you know showed everything except them:
            invitations, a search box and strangers to add. The roster is the
            point of the screen, so it is on it. */}
        {!searching && incoming.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>
              Wants to connect
            </Text>
            <Card style={{ gap: space.lg }}>
              {incoming.map((p) => (
                <PersonRowItem
                  key={p.user_id}
                  person={p}
                  onPress={() => openPerson(p.user_id)}
                  actions={[
                    {
                      label: "Accept",
                      tone: "primary" as const,
                      onPress: () => acceptFriendRequest(p.user_id),
                    },
                    { label: "Ignore", onPress: () => removeFriend(p.user_id) },
                  ]}
                />
              ))}
            </Card>
          </View>
        ) : null}

        {!searching ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>
              Friends{friends.length > 0 ? ` · ${friends.length}` : ""}
            </Text>
            {friends.length === 0 ? (
              <Card>
                <Muted>
                  Nobody yet. Add someone you plan with below, or search for
                  their &handle.
                </Muted>
              </Card>
            ) : (
              <Card style={{ gap: space.lg }}>
                {friends.map((p) => (
                  <PersonRowItem
                    key={p.user_id}
                    person={p}
                    onPress={() => openPerson(p.user_id)}
                    // What each person can see of you, on the row rather than
                    // behind a settings screen (§7.4).
                    context={grantLabel(p.grants)}
                    contextTone={(p.grants ?? "none") === "none" ? "muted" : "notice"}
                    actions={[{ label: "Open", onPress: () => openPerson(p.user_id) }]}
                  />
                ))}
              </Card>
            )}
          </View>
        ) : null}

        {!searching && outgoing.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>Asked</Text>
            <Card style={{ gap: space.lg }}>
              {outgoing.map((p) => (
                <PersonRowItem
                  key={p.user_id}
                  person={p}
                  onPress={() => openPerson(p.user_id)}
                  context="waiting for them"
                  actions={[
                    { label: "Cancel", onPress: () => removeFriend(p.user_id) },
                  ]}
                />
              ))}
            </Card>
          </View>
        ) : null}

        {!searching ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>
              People you've planned with
            </Text>

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
                    onPress={() => openPerson(p.user_id)}
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

/** What this friend can see of you, in three words (§7.4). */
const grantLabel = (g: FriendGrants | null): string =>
  g === "full"
    ? "sees everything"
    : g === "busy"
      ? "sees when you're free"
      : "sees nothing";

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
