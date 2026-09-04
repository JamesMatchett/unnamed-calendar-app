import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";

import { badgeCounts, getProfile } from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Two header affordances, deliberately different in kind (§3.5).
 *
 *   left  — People: a DESTINATION. Who you're connected to, who wants to
 *           connect, what you've been invited to. It carries a badge because
 *           things are waiting there, not because it is a second feed.
 *   right — Activity: a FEED. What's happening in calendars you're already in.
 *
 * Splitting them means a request that needs an answer is never buried under
 * ambient news. Keeping the left one a place rather than a feed means there is
 * still only one inbox to check.
 *
 * They live on tab roots only: on a pushed screen the header-left is the back
 * button, and People is a top-level destination rather than something you reach
 * for mid-flow.
 */

function Badge({ count }: { count: number }) {
  const t = useTheme();
  if (count === 0) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: -4,
        right: -6,
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        borderRadius: radius.pill,
        backgroundColor: t.color.accentFill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: "700", color: t.color.onAccent }}>
        {count > 9 ? "9+" : count}
      </Text>
    </View>
  );
}

export function PeopleButton() {
  const t = useTheme();
  const router = useRouter();
  const counts = useQuery("badges", () => badgeCounts());

  return (
    <Pressable
      onPress={() => router.push("/people")}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={
        counts.people > 0
          ? `People, ${counts.people} waiting for you`
          : "People"
      }
      style={{ paddingRight: space.lg }}
    >
      <View>
        <Ionicons name="people-outline" size={23} color={t.color.text} />
        <Badge count={counts.people} />
      </View>
    </Pressable>
  );
}

/**
 * Me. Outermost on the left, with People inboard of it: you come before the
 * people you know, and the far corner is the spot a thumb finds without looking.
 *
 * The avatar doubles as the affordance: a face is recognisably "you" in a way a
 * person-shaped icon next to another person-shaped icon is not.
 */
export function ProfileButton() {
  const t = useTheme();
  const router = useRouter();
  const profile = useQuery("profile", () => getProfile());

  return (
    <Pressable
      onPress={() => router.push("/profile")}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      style={{ paddingLeft: space.lg, paddingRight: space.md }}
    >
      {profile.avatar ? (
        <Image
          source={{ uri: profile.avatar }}
          accessibilityIgnoresInvertColors
          style={{
            width: 25,
            height: 25,
            borderRadius: 13,
            backgroundColor: t.color.surfaceAlt,
          }}
        />
      ) : (
        <View
          style={{
            width: 25,
            height: 25,
            borderRadius: 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.color.surfaceAlt,
          }}
        >
          <Text style={{ ...type.caption, fontWeight: "700", color: t.color.textMuted }}>
            {profile.displayName.trim().charAt(0).toUpperCase() || "?"}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function ActivityButton() {
  const t = useTheme();
  const router = useRouter();
  const counts = useQuery("badges", () => badgeCounts());

  return (
    <Pressable
      onPress={() => router.push("/activity")}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={
        counts.activity > 0
          ? `Activity, ${counts.activity} needing a response`
          : "Activity"
      }
      style={{ paddingHorizontal: space.lg }}
    >
      <View>
        <Ionicons name="notifications-outline" size={23} color={t.color.text} />
        <Badge count={counts.activity} />
      </View>
    </Pressable>
  );
}
