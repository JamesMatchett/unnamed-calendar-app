import { Ionicons } from "@expo/vector-icons";
import { canSeeFreeBusy } from "@calder/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { Cover, CoverPlaceholder } from "@/components/Cover";
import { Segmented } from "@/components/form";
import { AvatarStack, Card, EmptyState, Group, Muted } from "@/components/ui";
import type { FriendGrants } from "@/db/repo";
import {
  acceptFriendRequest,
  friendProfile,
  inviteUser,
  myPrivateCalendarsWithout,
  removeFriend,
  sendFriendRequest,
  setFriendGrants,
  sharedCalendars,
} from "@/db/repo";
import { formatDateRange } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * What each level lets them see, in the second person, because the question a
 * person is really asking is "what does this show them about me?" (§7.4).
 */
const GRANTS: { value: FriendGrants; label: string; detail: string }[] = [
  {
    value: "none",
    label: "Nothing",
    detail: "They can't see anything about your time.",
  },
  {
    value: "busy",
    label: "When I'm free",
    detail: "They see busy and free stretches. No titles, no places, no who.",
  },
  {
    value: "full",
    label: "Everything",
    detail: "They see your events: titles, times and places.",
  },
];

const SHARED_WITH_ME: Record<FriendGrants, string> = {
  none: "They don't show you their time.",
  busy: "They show you when they're free.",
  full: "They show you their whole calendar.",
};

/**
 * One person's page (§7.3, §7.4).
 *
 * The three things you might want from somebody in a shared-calendar app, in
 * the order you want them: what we can see of each other, when we could next
 * meet, and which of my calendars they are missing from. They were previously
 * three different screens and a guess, which meant the app had a friends list
 * but no way to actually do anything with a friend.
 *
 * Visibility comes first and is stated in both directions on purpose. It is per
 * direction, it does not have to match, and §7.4 requires that who can see what
 * is never buried: this is the page where somebody checks.
 */
export default function PersonScreen() {
  const t = useTheme();
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const person = useQuery(`person:${userId}`, () => friendProfile(userId));
  const shared = useQuery(`shared:${userId}`, () => sharedCalendars(userId));
  const inviteable = useQuery(`inviteable:${userId}`, () =>
    myPrivateCalendarsWithout(userId),
  );

  if (!person) {
    return (
      <>
        <Stack.Screen options={{ title: "Person", presentation: "modal" }} />
        <EmptyState title="Not found" body="This person is no longer listed." />
      </>
    );
  }

  const friends = person.status === "accepted";
  const theyShare = (person.shares ?? "none") as FriendGrants;
  const iShare = (person.grants ?? "none") as FriendGrants;

  /**
   * Escalating to the full calendar is the highest-risk permission in the
   * product (§7.4), so it does not happen on a single tap. Stepping back down
   * does, because making it harder to share less would be exactly backwards.
   */
  const changeGrants = (next: FriendGrants) => {
    if (next === "full" && iShare !== "full") {
      Alert.alert(
        `Show ${person.display_name} your full calendar?`,
        "They'll see the titles, times and places of everything in your calendar. You can turn this off at any time, and they won't be told.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Show everything",
            style: "destructive",
            onPress: () => setFriendGrants(userId, next),
          },
        ],
      );
      return;
    }
    setFriendGrants(userId, next);
  };

  const unfriend = () =>
    Alert.alert(
      `Remove ${person.display_name}?`,
      "They stay on any calendar you both belong to. You just stop being connected.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            removeFriend(userId);
            router.back();
          },
        },
      ],
    );

  return (
    <>
      <Stack.Screen
        options={{ title: person.display_name, presentation: "modal" }}
      />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: 64 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <AvatarStack names={[person.display_name]} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.title, color: t.color.text }}>
              {person.display_name}
            </Text>
            <Muted>
              &{person.handle}
              {friends && person.since ? ` · friends since ${year(person.since)}` : ""}
            </Muted>
          </View>
        </View>

        {person.status === "pending_in" ? (
          <Card style={{ gap: space.md }}>
            <Text style={{ ...type.body, color: t.color.text }}>
              {person.display_name} asked to connect.
            </Text>
            <View style={{ flexDirection: "row", gap: space.md }}>
              <Pressable
                onPress={() => acceptFriendRequest(userId)}
                accessibilityRole="button"
              >
                <Text style={{ ...type.label, color: t.color.accent }}>Accept</Text>
              </Pressable>
              <Pressable onPress={() => removeFriend(userId)} accessibilityRole="button">
                <Text style={{ ...type.label, color: t.color.textMuted }}>Ignore</Text>
              </Pressable>
            </View>
          </Card>
        ) : null}

        {person.status === "pending_out" ? (
          <Card>
            <Muted>Request sent. Nothing else happens until they answer.</Muted>
          </Card>
        ) : null}

        {person.status === null ? (
          <Card style={{ gap: space.md }}>
            <Muted>
              You plan things with {person.display_name} but you are not connected.
            </Muted>
            <Pressable
              onPress={() => sendFriendRequest(userId)}
              accessibilityRole="button"
            >
              <Text style={{ ...type.label, color: t.color.accent }}>
                Ask to connect
              </Text>
            </Pressable>
          </Card>
        ) : null}

        {/* 1. Permissions, both ways. */}
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            What {person.display_name} can see
          </Text>
          <Segmented
            value={iShare}
            onChange={(v) => changeGrants(v as FriendGrants)}
            options={GRANTS.map((g) => ({ value: g.value, label: g.label }))}
          />
          <Muted>{GRANTS.find((g) => g.value === iShare)?.detail}</Muted>

          <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Ionicons
              name={canSeeFreeBusy(theyShare) ? "eye-outline" : "eye-off-outline"}
              size={17}
              color={canSeeFreeBusy(theyShare) ? t.color.going : t.color.textMuted}
            />
            <Text style={{ ...type.body, flex: 1, color: t.color.text }}>
              {SHARED_WITH_ME[theyShare]}
            </Text>
          </Card>
          {/* Their side is theirs to change. Saying so is better than a control
              that looks live and silently does nothing. */}
          <Muted>Only they can change what they show you.</Muted>
        </View>

        {/* 2. Finding a time. */}
        <View style={{ gap: space.sm }}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/person/[userId]/catch-up",
                params: { userId },
              })
            }
            disabled={!canSeeFreeBusy(theyShare)}
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.sm,
              paddingVertical: space.lg,
              borderRadius: radius.md,
              backgroundColor: canSeeFreeBusy(theyShare)
                ? t.color.accent
                : t.color.surfaceAlt,
            }}
          >
            <Ionicons
              name="calendar-outline"
              size={18}
              color={canSeeFreeBusy(theyShare) ? t.color.onAccent : t.color.textMuted}
            />
            <Text
              style={{
                ...type.label,
                fontSize: 16,
                color: canSeeFreeBusy(theyShare) ? t.color.onAccent : t.color.textMuted,
              }}
            >
              Catch up with {person.display_name.split(" ")[0]}
            </Text>
          </Pressable>
          {canSeeFreeBusy(theyShare) ? null : (
            <Muted>
              Finding a time needs to see when they're free, and they haven't
              shared that. Ask them, or pick a time and invite them to it.
            </Muted>
          )}
        </View>

        {/* 3. Where you already overlap, and where they are missing. */}
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Calendars you share
          </Text>
          {shared.length === 0 ? (
            <Card>
              <Muted>None yet. Invite them to one below.</Muted>
            </Card>
          ) : (
            <Group>
              {shared.map((c) => (
                <Pressable
                  key={c.calendar_id}
                  onPress={() =>
                    router.push({
                      pathname: "/calendar/[calendarId]",
                      params: { calendarId: c.calendar_id },
                    })
                  }
                  accessibilityRole="button"
                  style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
                >
                  {c.cover_image ? (
                    <View style={{ width: 46, height: 34, overflow: "hidden" }}>
                      <Cover value={c.cover_image} height={34} radiusSize={radius.sm} />
                    </View>
                  ) : (
                    <View style={{ width: 46 }}>
                      <CoverPlaceholder label="" height={34} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.body, color: t.color.text }}>{c.name}</Text>
                    <Muted>
                      {formatDateRange(
                        c.start_date ?? undefined,
                        c.end_date ?? undefined,
                      ) ?? "Ongoing"}
                    </Muted>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={t.color.textMuted} />
                </Pressable>
              ))}
            </Group>
          )}
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Invite to a private calendar
          </Text>
          {inviteable.length === 0 ? (
            <Card>
              <Muted>
                They are already on all of your private calendars. Start another
                one if this needs its own place.
              </Muted>
            </Card>
          ) : (
            <Group>
              {inviteable.map((c) => (
                <View
                  key={c.calendar_id}
                  style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
                >
                  <Text style={{ ...type.body, flex: 1, color: t.color.text }}>
                    {c.name}
                  </Text>
                  <Pressable
                    onPress={() => inviteUser(c.calendar_id, userId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Invite ${person.display_name} to ${c.name}`}
                    style={{
                      paddingHorizontal: space.md,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: t.color.border,
                    }}
                  >
                    <Text style={{ ...type.caption, fontWeight: "600", color: t.color.accent }}>
                      Invite
                    </Text>
                  </Pressable>
                </View>
              ))}
            </Group>
          )}

          <Pressable
            onPress={() => router.push("/calendar/new")}
            accessibilityRole="button"
          >
            <Text style={{ ...type.label, color: t.color.accent }}>
              Start a private calendar
            </Text>
          </Pressable>
        </View>

        {friends ? (
          <Pressable onPress={unfriend} accessibilityRole="button">
            <Text
              style={{
                ...type.caption,
                color: t.color.danger,
                textAlign: "center",
                paddingVertical: space.md,
              }}
            >
              Remove {person.display_name}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </>
  );
}

const year = (iso: string): string => iso.slice(0, 4);
