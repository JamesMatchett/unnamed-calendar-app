import { Ionicons } from "@expo/vector-icons";
import type { NotificationKind } from "@uca/core";
import { isActionable } from "@uca/core";
import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Card, EmptyState } from "@/components/ui";
import type { NotificationRow } from "@/db/repo";
import { listActivity, markSurfaceRead } from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

/**
 * Activity: what is happening in calendars I am already in (§3.5).
 *
 * Ambient by nature, so items that need an answer — a suggestion on my event, a
 * nudge — sort to the top and are the only ones the badge counts. A badge that
 * counts news teaches people to ignore the badge.
 */
export default function ActivityScreen() {
  const t = useTheme();
  const items = useQuery("activity", () => listActivity());

  useEffect(() => {
    markSurfaceRead("activity");
  }, []);

  if (items.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: "Activity", presentation: "modal" }} />
        <EmptyState
          title="Nothing new"
          body="Events added, changes and cancellations in your calendars show up here."
        />
      </>
    );
  }

  const needsYou = items.filter((n) => isActionable(n.kind));
  const rest = items.filter((n) => !isActionable(n.kind));

  return (
    <>
      <Stack.Screen options={{ title: "Activity", presentation: "modal" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        {needsYou.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>
              Needs you
            </Text>
            <Card style={{ gap: space.lg }}>
              {needsYou.map((n) => (
                <Row key={n.notification_id} item={n} />
              ))}
            </Card>
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>Recent</Text>
          <Card style={{ gap: space.lg }}>
            {rest.map((n) => (
              <Row key={n.notification_id} item={n} />
            ))}
          </Card>
        </View>
      </ScrollView>
    </>
  );
}

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  event_added: "calendar-outline",
  event_cancelled: "close-circle-outline",
  event_deleted_by_owner: "trash-outline",
  suggestion_received: "create-outline",
  suggestion_accepted: "checkmark-circle-outline",
  suggestion_rejected: "close-circle-outline",
  rsvp_nudge: "hand-left-outline",
};

function describe(n: NotificationRow): string {
  const who = n.actor_name ?? "Someone";
  const what = n.event_title ?? "an event";
  const map: Record<NotificationKind, string> = {
    event_added: `${who} added ${what}`,
    event_cancelled: `${what} was cancelled`,
    event_deleted_by_owner: `${who} deleted ${what}`,
    suggestion_received: `${who} suggested a change to ${what}`,
    suggestion_accepted: `Your change to ${what} was accepted`,
    suggestion_rejected: `Your change to ${what} wasn't taken`,
    rsvp_nudge: `${who} is waiting on your answer for ${what}`,
    invite_pending: `${who} invited you`,
    join_request: `${who} wants to join`,
    joined_via_link: `${who} joined via an invite link`,
    removed_from_calendar: `You were removed`,
    ownership_granted: `${who} made you an owner`,
    ownership_revoked: `You're no longer an owner`,
    calendar_deleted: `The calendar was deleted`,
  };
  return map[n.kind];
}

function Row({ item }: { item: NotificationRow }) {
  const t = useTheme();
  const router = useRouter();

  const go = () => {
    // A suggestion is a question, so it opens the answer screen rather than the
    // calendar it happened in.
    if (item.kind === "suggestion_received" && item.event_id) {
      router.push({
        pathname: "/suggestion",
        params: { eventId: item.event_id },
      });
      return;
    }

    if (item.calendar_id) {
      router.push({
        pathname: "/calendar/[calendarId]",
        params: { calendarId: item.calendar_id },
      });
    }
  };

  return (
    <Pressable
      onPress={go}
      accessibilityRole="button"
      style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}
    >
      <Ionicons
        name={ICON[item.kind] ?? "ellipse-outline"}
        size={19}
        color={item.read_at === null ? t.color.accent : t.color.textMuted}
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, fontSize: 15, color: t.color.text }}>
          {describe(item)}
        </Text>
        <Text style={{ ...type.caption, color: t.color.textMuted }}>
          {item.calendar_name} · {relative(item.created_at)}
        </Text>
      </View>
    </Pressable>
  );
}

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
