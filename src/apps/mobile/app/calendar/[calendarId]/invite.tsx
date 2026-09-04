import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { Card, EmptyState, Muted } from "@/components/ui";
import {
  getCalendar,
  getInviteLink,
  listMembers,
  myMembership,
  rotateInviteLink,
} from "@/db/repo";
import { shareLink } from "@/lib/share";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/** Where a scanned or tapped invite lands. Universal links point here (§7.1). */
const inviteUrl = (token: string) => `https://calder.app/join/${token}`;

/**
 * The share screen.
 *
 * The QR is for the moment people are stood together, which is when a shared
 * calendar actually gets its second member. The share sheet is for everyone
 * else, and is where most of the reach comes from.
 *
 * One rotating link for the whole calendar rather than one per person: groups
 * paste links into group chats and six people tap them, and per-person tokens
 * fight that. Attribution still works because the token records who made it.
 */
export default function InviteScreen() {
  const t = useTheme();
  const { calendarId } = useLocalSearchParams<{ calendarId: string }>();

  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const members = useQuery(`members:${calendarId}`, () => listMembers(calendarId));
  const me = useQuery(`me:${calendarId}`, () => myMembership(calendarId));
  const link = useQuery(`link:${calendarId}`, () => getInviteLink(calendarId));

  if (!calendar || !me) {
    return <EmptyState title="Not found" body="This calendar is no longer available." />;
  }

  const mayInvite =
    me.role === "owner" || calendar.allow_member_invites === 1;

  if (!mayInvite) {
    return (
      <>
        <Stack.Screen options={{ title: "Invite", presentation: "modal" }} />
        <EmptyState
          title="Only owners can invite"
          body={`${calendar.name} is set up so that only its owners bring people in. Ask one of them.`}
        />
      </>
    );
  }

  const current = link ?? rotateInviteLink(calendarId);
  const url = inviteUrl(current.token);

  const share = () => {
    void shareLink({
      text: `Join ${calendar.name} on Cal&der`,
      url,
      subject: `Join ${calendar.name} on Cal&der`,
    });
  };

  const rotate = () =>
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
    );

  return (
    <>
      <Stack.Screen options={{ title: "Invite people", presentation: "modal" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <View style={{ alignItems: "center", gap: space.md }}>
          <Text style={{ ...type.title, color: t.color.text, textAlign: "center" }}>
            {calendar.name}
          </Text>
          <Muted>
            {members.length} {members.length === 1 ? "person" : "people"} so far
          </Muted>

          <View
            style={{
              padding: space.lg,
              backgroundColor: "#fff",
              borderRadius: radius.lg,
            }}
          >
            {/* Always on white regardless of theme: a dark-mode QR with an
                inverted quiet zone is unreadable to most scanners. */}
            <QRCode value={url} size={220} backgroundColor="#fff" color="#000" />
          </View>

          <Muted>Point a camera at this to join</Muted>
        </View>

        <View style={{ gap: space.sm }}>
          <Pressable
            onPress={share}
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.sm,
              paddingVertical: space.lg - 2,
              borderRadius: radius.pill,
              backgroundColor: t.color.accentFill,
            }}
          >
            <Ionicons name="share-outline" size={19} color={t.color.onAccent} />
            <Text style={{ ...type.label, fontSize: 16, color: t.color.onAccent }}>
              Send the link instead
            </Text>
          </Pressable>

          <Card style={{ gap: space.xs }}>
            <Text
              selectable
              style={{ ...type.caption, color: t.color.textMuted }}
            >
              {url}
            </Text>
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            What happens next
          </Text>
          <Card style={{ gap: space.sm }}>
            <Row
              icon={calendar.require_approval === 1 ? "shield-checkmark-outline" : "enter-outline"}
              text={
                calendar.require_approval === 1
                  ? "Everyone who uses this link needs approving by an owner, however they got it."
                  : "Anyone with this link joins straight away, without approval."
              }
            />
            <Row
              icon="people-outline"
              text={`Used ${current.uses} ${current.uses === 1 ? "time" : "times"} so far.`}
            />
          </Card>

          <Pressable onPress={rotate} accessibilityRole="button">
            <Text style={{ ...type.caption, color: t.color.accent }}>
              Replace this link
            </Text>
          </Pressable>
          <Muted>
            One link for the whole calendar. Replacing it revokes every copy at
            once.
          </Muted>
        </View>
      </ScrollView>
    </>
  );
}

function Row({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={17} color={t.color.textMuted} style={{ marginTop: 1 }} />
      <Text style={{ ...type.caption, color: t.color.text, flex: 1 }}>{text}</Text>
    </View>
  );
}
