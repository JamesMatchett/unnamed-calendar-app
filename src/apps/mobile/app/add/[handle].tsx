import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/form";
import { Card, EmptyState, Muted } from "@/components/ui";
import {
  getProfile,
  normaliseHandle,
  personByHandle,
  rememberScannedPerson,
  sendFriendRequest,
} from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Where a scanned code lands: "Add Priya?" (§7.3).
 *
 * The handle comes from the path and the name from the query string, because
 * there is no server to ask who a handle belongs to. That makes the name
 * something the code asserts rather than something the app knows, so this
 * screen leads with the handle, which is the part that will be verified when
 * there is something to verify it against.
 *
 * Nothing is written until the button is pressed. A link that adds somebody the
 * moment it opens is a link that adds somebody when it is tapped by accident,
 * or forwarded, and undoing it means explaining a friend request nobody sent.
 */
export default function AddByHandleScreen() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ handle: string; n?: string }>();

  const handle = normaliseHandle(params.handle ?? "");
  const offered = (params.n ?? "").trim();

  const me = useQuery("profile", () => getProfile());
  const known = useQuery(`person:${handle}`, () => personByHandle(handle));
  const [sent, setSent] = useState(false);

  if (handle.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: "Add someone" }} />
        <EmptyState
          title="This code did not scan properly"
          body="Ask them to show it again, or search for them by handle instead."
        />
      </>
    );
  }

  // Scanning your own code is easy to do while testing that it works, and
  // "add yourself" would be a strange thing for the app to offer.
  if (normaliseHandle(me.handle) === handle) {
    return (
      <>
        <Stack.Screen options={{ title: "Your code" }} />
        <EmptyState
          title="That's you"
          body="This is your own code. Show it to somebody else and have them scan it."
          actionLabel="Show my code"
          onAction={() => router.replace("/connect")}
        />
      </>
    );
  }

  const name = known?.display_name ?? offered;
  const already = known?.status ?? null;

  const add = () => {
    // Written down at the moment of adding, not on arrival: somebody who opens
    // the link and backs out has not asked for a stranger in their directory.
    const userId = known?.user_id ?? rememberScannedPerson(handle, offered);
    if (!userId) return;
    sendFriendRequest(userId);
    setSent(true);
  };

  return (
    <>
      <Stack.Screen options={{ title: "Add someone" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <View style={{ alignItems: "center", gap: space.sm }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: t.color.surfaceAlt,
            }}
          >
            <Text style={{ ...type.title, color: t.color.textMuted }}>
              {(name || handle).charAt(0).toUpperCase()}
            </Text>
          </View>

          {/* The handle is the heading, because it is the part that is real.
              A name from a query string is whatever was typed into it. */}
          <Text style={{ ...type.title, color: t.color.text }}>&{handle}</Text>
          {name ? (
            <Text style={{ ...type.body, color: t.color.textMuted }}>{name}</Text>
          ) : null}
        </View>

        {sent || already === "pending_out" ? (
          <Card style={{ gap: space.sm, alignItems: "center" }}>
            <Ionicons name="checkmark-circle" size={26} color={t.color.accent} />
            <Text style={{ ...type.label, color: t.color.text }}>Request sent</Text>
            <Muted>
              They will see it next time they open Cal&der. You will both appear
              in each other's people list once they say yes.
            </Muted>
          </Card>
        ) : already === "accepted" ? (
          <Card style={{ gap: space.sm, alignItems: "center" }}>
            <Ionicons name="people" size={26} color={t.color.accent} />
            <Text style={{ ...type.label, color: t.color.text }}>
              You are already connected
            </Text>
          </Card>
        ) : already === "pending_in" ? (
          <View style={{ gap: space.sm }}>
            <Card>
              <Muted>
                They have already asked to connect with you. Saying yes here
                settles it from both sides.
              </Muted>
            </Card>
            <PrimaryButton label="Accept" onPress={add} />
          </View>
        ) : (
          <View style={{ gap: space.sm }}>
            <PrimaryButton label={`Add ${name || `&${handle}`}`} onPress={add} />
            <Muted>
              Nothing is shared until they accept, and what they can see after
              that is yours to set, per person.
            </Muted>
          </View>
        )}

        {!known ? (
          <View
            style={{
              padding: space.md,
              borderRadius: radius.md,
              backgroundColor: t.color.accentSoft,
            }}
          >
            <Text style={{ ...type.caption, color: t.color.text }}>
              This alpha keeps everything on this phone, so adding them here
              records it on your side only. They will not see the request until
              accounts are talking to each other.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
