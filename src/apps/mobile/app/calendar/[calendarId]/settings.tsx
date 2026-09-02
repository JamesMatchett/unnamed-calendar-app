import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";

import type { TravelMode } from "@uca/core";

import { PersonRowItem } from "@/components/PersonRowItem";
import { TravelModePicker } from "@/components/TravelMode";
import { SearchBar } from "@/components/SearchBar";
import { Field, RowButton, TextField, ToggleRow } from "@/components/form";
import { Card, EmptyState, Muted } from "@/components/ui";
import {
  getCalendar,
  getInviteLink,
  inviteUser,
  leavingWouldOrphanCalendar,
  listMembers,
  listSentInvites,
  myAvailability,
  myMembership,
  rotateInviteLink,
  searchPeople,
  setMemberRole,
  setMemberStatus,
  setMyAvailability,
  updateCalendar,
} from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { formatClock } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Calendar settings, in the order a person cares about them: what this calendar
 * asks of *me*, then how I leave it, then — only for owners — how it is run.
 *
 * Owner controls are not merely hidden from members; a member has no route to
 * them at all, which keeps "what can I do here?" answerable by looking.
 */
export default function CalendarSettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { calendarId } = useLocalSearchParams<{ calendarId: string }>();

  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const me = useQuery(`me:${calendarId}`, () => myMembership(calendarId));
  const members = useQuery(`members:${calendarId}`, () => listMembers(calendarId));

  if (!calendar || !me) {
    return <EmptyState title="Not found" body="This calendar is no longer available." />;
  }

  const isOwner = me.role === "owner";

  const leave = () => {
    if (leavingWouldOrphanCalendar(calendarId)) {
      Alert.alert(
        "Make someone else an owner first",
        "You're the only owner. If you leave now, nobody could approve people joining, cancel events or delete the calendar.",
      );
      return;
    }

    Alert.alert(
      `Leave ${calendar.name}?`,
      "Events you added stay for everyone else. Your replies and your arrival times are removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            setMemberStatus(calendarId, CURRENT_USER_ID, "left");
            router.dismissAll();
            router.replace("/calendars");
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: "Calendar settings", presentation: "modal" }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {calendar.collect_availability === 1 ? (
          <YourTrip
            calendarId={calendarId}
            tz={calendar.default_tz}
            calendarTravelMode={calendar.travel_mode}
          />
        ) : null}

        {isOwner ? (
          <OwnerControls
            calendarId={calendarId}
            calendar={calendar}
            members={members}
          />
        ) : (
          <Muted>
            Only owners can change this calendar's name or invite people.
          </Muted>
        )}

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>Leaving</Text>
          <Pressable
            onPress={leave}
            accessibilityRole="button"
            style={{
              alignItems: "center",
              paddingVertical: space.lg - 2,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: t.color.danger,
            }}
          >
            <Text style={{ ...type.label, fontSize: 16, color: t.color.danger }}>
              Leave this calendar
            </Text>
          </Pressable>
          <Muted>
            Events you added stay for everyone else. Your replies go with you.
          </Muted>
        </View>
      </ScrollView>
    </>
  );
}

/**
 * Only shown when the calendar collects it (§4.3) — asking "when will you be in
 * the country?" makes no sense for a night out at home, which is why it was a
 * toggle at creation rather than a permanent field.
 */
function YourTrip({
  calendarId,
  tz,
  calendarTravelMode,
}: {
  calendarId: string;
  tz: string;
  calendarTravelMode: TravelMode;
}) {
  const t = useTheme();
  const availability = useQuery(`avail:${calendarId}`, () => myAvailability(calendarId));
  const [picking, setPicking] = useState<"arrive" | "depart" | null>(null);

  const arrives = availability?.arrives_at ?? null;
  const departs = availability?.departs_at ?? null;
  const mine = availability?.travel_mode ?? null;
  // Unset follows the calendar, so changing the group's mode still moves anyone
  // who never picked their own.
  const effective = mine ?? calendarTravelMode;

  const label = (value: string | null) =>
    value
      ? `${new Date(value).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          timeZone: tz,
        })}, ${formatClock(value, tz)}`
      : "Not said";

  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ ...type.label, color: t.color.textMuted }}>Your trip</Text>

      <RowButton
        label="You arrive"
        value={label(arrives)}
        onPress={() => setPicking(picking === "arrive" ? null : "arrive")}
      />
      <RowButton
        label="You leave"
        value={label(departs)}
        onPress={() => setPicking(picking === "depart" ? null : "depart")}
      />

      {picking ? (
        <DateTimePicker
          value={new Date((picking === "arrive" ? arrives : departs) ?? Date.now())}
          mode="datetime"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={(_, selected) => {
            if (Platform.OS !== "ios") setPicking(null);
            if (!selected) return;
            const iso = selected.toISOString();
            setMyAvailability(
              calendarId,
              picking === "arrive" ? iso : arrives,
              picking === "depart" ? iso : departs,
              mine,
            );
          }}
        />
      ) : null}

      <Field label="How are you getting there?">
        <TravelModePicker
          value={effective}
          onChange={(v) => setMyAvailability(calendarId, arrives, departs, v)}
        />
      </Field>

      {mine !== null ? (
        <Pressable
          onPress={() => setMyAvailability(calendarId, arrives, departs, null)}
          accessibilityRole="button"
        >
          <Text style={{ ...type.caption, color: t.color.accent }}>
            Follow the group instead
          </Text>
        </Pressable>
      ) : (
        <Muted>Following the group. Pick one above if you're travelling differently.</Muted>
      )}

      {arrives || departs ? (
        <Pressable
          onPress={() => setMyAvailability(calendarId, null, null, mine)}
          accessibilityRole="button"
        >
          <Text style={{ ...type.caption, color: t.color.accent }}>
            Clear my times
          </Text>
        </Pressable>
      ) : null}

      <Muted>
        Everyone on the calendar can see when you're around. Times are in the
        calendar's zone.
      </Muted>
    </View>
  );
}

/**
 * Everything that changes the calendar for everyone else. Owners only, and
 * grouped so that "who can get in" reads as one decision rather than three
 * unrelated switches.
 */
function OwnerControls({
  calendarId,
  calendar,
  members,
}: {
  calendarId: string;
  calendar: NonNullable<ReturnType<typeof getCalendar>>;
  members: ReturnType<typeof listMembers>;
}) {
  const t = useTheme();
  const [name, setName] = useState(calendar.name);
  const [query, setQuery] = useState("");

  const results = useQuery(`invite-search:${query}`, () => searchPeople(query));
  const sent = useQuery(`sent:${calendarId}`, () => listSentInvites(calendarId));
  const link = useQuery(`link:${calendarId}`, () => getInviteLink(calendarId));

  const alreadyIn = new Set(members.map((m) => m.user_id));
  const alreadyAsked = new Set(sent.map((s) => s.user_id));

  const share = async () => {
    const current = link ?? rotateInviteLink(calendarId);
    const url = `https://uca.app/join/${current.token}`;
    await Share.share({ message: `Join ${calendar.name} on UCA: ${url}` }).catch(
      () => undefined,
    );
  };

  const demote = (userId: string, displayName: string) => {
    // Ownership is flat: any owner can demote any other, including whoever
    // created the calendar (§8.3). Worth a confirmation rather than a stray tap.
    Alert.alert(
      `Remove ${displayName} as an owner?`,
      "They'll stay in the calendar as a member.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", onPress: () => setMemberRole(calendarId, userId, "member") },
      ],
    );
  };

  const kick = (userId: string, displayName: string) => {
    Alert.alert(
      `Remove ${displayName}?`,
      "Events they added stay. They can rejoin with a valid link, and you'll be asked to approve them.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => setMemberStatus(calendarId, userId, "removed"),
        },
      ],
    );
  };

  return (
    <>
      <View style={{ gap: space.sm }}>
        <Text style={{ ...type.label, color: t.color.textMuted }}>Name</Text>
        <TextField
          value={name}
          onChange={setName}
          placeholder="Calendar name"
          maxLength={60}
        />
        {name.trim() !== calendar.name && name.trim().length > 0 ? (
          <Pressable
            onPress={() => updateCalendar(calendarId, { name })}
            accessibilityRole="button"
          >
            <Text style={{ ...type.caption, color: t.color.accent }}>
              Save name
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={{ ...type.label, color: t.color.textMuted }}>Who can get in</Text>
        <ToggleRow
          label="Approve everyone who joins"
          hint="Every new member is approved by an owner, however they were invited."
          value={calendar.require_approval === 1}
          onChange={(v) => updateCalendar(calendarId, { requireApproval: v })}
        />
        <ToggleRow
          label="Members can invite people"
          hint="They still can't let anyone in. You approve."
          value={calendar.allow_member_invites === 1}
          onChange={(v) => updateCalendar(calendarId, { allowMemberInvites: v })}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={{ ...type.label, color: t.color.textMuted }}>
          What members can do
        </Text>
        <ToggleRow
          label="Let anyone add events"
          hint="Off makes it a calendar you curate, so only owners can add things."
          value={calendar.allow_member_events === 1}
          onChange={(v) => updateCalendar(calendarId, { allowMemberEvents: v })}
        />
        <ToggleRow
          label="Ask when people arrive and leave"
          hint="Useful when everyone turns up at different times."
          value={calendar.collect_availability === 1}
          onChange={(v) => updateCalendar(calendarId, { collectAvailability: v })}
        />

        {calendar.collect_availability === 1 ? (
          <Field label="How are people getting there?">
            <TravelModePicker
              value={calendar.travel_mode}
              onChange={(v) => updateCalendar(calendarId, { travelMode: v })}
            />
          </Field>
        ) : null}
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={{ ...type.label, color: t.color.textMuted }}>Invite someone</Text>
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search @handle, name or email"
        />

        {query.trim().length > 0 ? (
          <Card style={{ gap: space.lg }}>
            {results.length === 0 ? (
              <Muted>Nobody matching "{query.trim()}".</Muted>
            ) : (
              results.map((p) => (
                <PersonRowItem
                  key={p.user_id}
                  person={p}
                  context={
                    alreadyIn.has(p.user_id)
                      ? "already here"
                      : alreadyAsked.has(p.user_id)
                        ? "invited"
                        : undefined
                  }
                  actions={
                    alreadyIn.has(p.user_id) || alreadyAsked.has(p.user_id)
                      ? []
                      : [
                          {
                            label: "Invite",
                            tone: "primary" as const,
                            onPress: () => inviteUser(calendarId, p.user_id),
                          },
                        ]
                  }
                />
              ))
            )}
          </Card>
        ) : null}

        {sent.length > 0 ? (
          <Muted>
            Waiting on {sent.map((s) => s.display_name).join(", ")}
          </Muted>
        ) : null}
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={{ ...type.label, color: t.color.textMuted }}>Invite link</Text>
        <Pressable
          onPress={() => void share()}
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            backgroundColor: t.color.surface,
            borderWidth: 1,
            borderColor: t.color.border,
            borderRadius: radius.md,
            padding: space.lg,
          }}
        >
          <Ionicons name="link-outline" size={19} color={t.color.accent} />
          <Text style={{ ...type.body, color: t.color.text, flex: 1 }}>
            {link ? "Share the link" : "Create a link"}
          </Text>
          <Ionicons name="chevron-forward" size={17} color={t.color.textMuted} />
        </Pressable>

        {link ? (
          <Pressable
            onPress={() =>
              Alert.alert(
                "Replace the link?",
                "The old link stops working immediately, for everyone you've already sent it to.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Replace",
                    style: "destructive",
                    onPress: () => rotateInviteLink(calendarId),
                  },
                ],
              )
            }
            accessibilityRole="button"
          >
            <Text style={{ ...type.caption, color: t.color.accent }}>
              Replace the link
            </Text>
          </Pressable>
        ) : null}

        <Muted>
          One link for the whole calendar. Replacing it revokes every copy at
          once.
        </Muted>
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={{ ...type.label, color: t.color.textMuted }}>
          People · {members.length}
        </Text>
        <Card style={{ gap: space.lg }}>
          {members.map((m) => {
            const isMe = m.user_id === CURRENT_USER_ID;
            const owner = m.role === "owner";
            return (
              <View
                key={m.user_id}
                style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
              >
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ ...type.body, fontSize: 15, color: t.color.text }}>
                    {m.display_name}
                    {isMe ? " (you)" : ""}
                  </Text>
                  <Text style={{ ...type.caption, color: t.color.textMuted }}>
                    {owner ? "Owner" : "Member"}
                  </Text>
                </View>

                {owner ? (
                  <Pressable
                    onPress={() => demote(m.user_id, m.display_name)}
                    hitSlop={6}
                    accessibilityRole="button"
                  >
                    <Text style={{ ...type.caption, color: t.color.textMuted }}>
                      Make member
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => setMemberRole(calendarId, m.user_id, "owner")}
                    hitSlop={6}
                    accessibilityRole="button"
                  >
                    <Text style={{ ...type.caption, color: t.color.accent }}>
                      Make owner
                    </Text>
                  </Pressable>
                )}

                {isMe ? null : (
                  <Pressable
                    onPress={() => kick(m.user_id, m.display_name)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${m.display_name}`}
                  >
                    <Ionicons name="close-circle-outline" size={19} color={t.color.danger} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </Card>
        <Muted>
          Making someone an owner hands over full control. They can then remove
          you.
        </Muted>
      </View>
    </>
  );
}
