import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/form";
import { Card, EmptyState, Muted } from "@/components/ui";
import { joinByToken, previewInvite } from "@/db/repo";
import type { JoinOutcome } from "@/db/repo";
import { formatDateRange } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * What someone sees when they open an invite: "Join Priya's Glastonbury 2027?"
 *
 * Counts only. No member names, no event titles. An invite link is a bearer
 * token that gets forwarded and screenshotted, so everything here has to be safe
 * in the hands of a stranger (§3.5) — and the web version of this page carries a
 * `noindex`, because an indexed invite is a private calendar in search results.
 *
 * It is also the acquisition surface: this is the first thing a person who has
 * never heard of the app will see, so it says what they are being asked to join
 * rather than what the app is.
 */
export default function JoinScreen() {
  const t = useTheme();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();

  const preview = useQuery(`invite:${token}`, () => previewInvite(token));
  const [outcome, setOutcome] = useState<JoinOutcome | null>(null);

  if (!preview) {
    return (
      <>
        <Stack.Screen options={{ title: "Invite" }} />
        <EmptyState
          title="This invite has expired"
          body="The link may have been replaced. Ask whoever sent it for a new one."
        />
      </>
    );
  }

  const range = formatDateRange(
    preview.startDate ?? undefined,
    preview.endDate ?? undefined,
  );

  const open = () => {
    router.dismissAll();
    router.navigate({
      pathname: "/calendar/[calendarId]",
      params: { calendarId: preview.calendarId },
    });
  };

  if (preview.alreadyMember || outcome === "already") {
    return (
      <>
        <Stack.Screen options={{ title: "Invite" }} />
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
          <Header name={preview.name} subtitle="You're already in this one." />
          <PrimaryButton label="Open it" onPress={open} />
        </ScrollView>
      </>
    );
  }

  if (outcome === "requested" || preview.requestPending) {
    return (
      <>
        <Stack.Screen options={{ title: "Invite" }} />
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
          <Header
            name={preview.name}
            subtitle={`${preview.invitedByName} needs to approve you.`}
          />
          <Card style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
            <Ionicons name="time-outline" size={19} color={t.color.maybe} />
            <Text style={{ ...type.body, color: t.color.text, flex: 1 }}>
              Asked to join. You'll get a notification when someone lets you in.
            </Text>
          </Card>
        </ScrollView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Invite" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <Header
          name={preview.name}
          subtitle={`${preview.invitedByName} invited you`}
        />

        <Card style={{ gap: space.md }}>
          <Fact
            icon={preview.mode === "bounded" ? "calendar-outline" : "infinite-outline"}
            value={range ?? "Ongoing, with no end date"}
          />
          <Fact
            icon="people-outline"
            value={`${preview.memberCount} ${preview.memberCount === 1 ? "person" : "people"}`}
          />
          <Fact
            icon="list-outline"
            value={`${preview.eventCount} ${preview.eventCount === 1 ? "event" : "events"} planned`}
          />
        </Card>

        <View style={{ gap: space.sm }}>
          <PrimaryButton
            label={preview.requiresApproval ? "Ask to join" : "Join"}
            onPress={() => setOutcome(joinByToken(token))}
          />
          {preview.requiresApproval ? (
            <Muted>
              {preview.invitedByName} approves everyone who joins, however they
              were invited.
            </Muted>
          ) : null}
        </View>

        <Muted>
          You'll be able to see what's planned and say whether you're coming. Only
          people in the calendar can see your answers.
        </Muted>
      </ScrollView>
    </>
  );
}

function Header({ name, subtitle }: { name: string; subtitle: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.xs, alignItems: "center", paddingTop: space.lg }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.lg,
          backgroundColor: t.color.accentSoft,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: space.sm,
        }}
      >
        <Ionicons name="calendar" size={28} color={t.color.accent} />
      </View>
      <Text style={{ ...type.title, color: t.color.text, textAlign: "center" }}>
        {name}
      </Text>
      <Text style={{ ...type.body, color: t.color.textMuted, textAlign: "center" }}>
        {subtitle}
      </Text>
    </View>
  );
}

function Fact({
  icon,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
      <Ionicons name={icon} size={19} color={t.color.textMuted} />
      <Text style={{ ...type.body, color: t.color.text, flex: 1 }}>{value}</Text>
    </View>
  );
}
