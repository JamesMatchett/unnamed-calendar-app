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
      // Nothing on the left, where the profile avatar is. Same trap as the pair
      // on the right: two neighbours each claiming ten pixels outward means
      // twenty pixels claimed twice, and the one drawn later silently takes
      // them.
      hitSlop={{ top: 10, bottom: 10, left: 0, right: 10 }}
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
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 0 }}
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

/**
 * The phone's own calendar, in and out (§5.7).
 *
 * Next to Activity rather than buried in Settings, because it is a thing you
 * DO, repeatedly, and often right after adding something: the moment you want
 * a trip to turn up beside your work meetings is the moment you have just
 * finished entering the trip. Settings is where you would put it if syncing
 * were configuration; it is closer to sending.
 *
 * No badge. Nothing is waiting here, and a number on this icon would compete
 * with the one next to it, which does mean somebody is waiting for you.
 */
export function SyncButton() {
  const t = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push("/sync")}
      // Slop upwards and to the LEFT only. A plain hitSlop of 10 grew this
      // button 10px to the right and Activity 10px to the left, which put a
      // 20px strip where both wanted the touch; Activity is drawn after this
      // one, so Activity won it. The strip covered the sync arrows, the part of
      // the icon anybody would actually aim at, so tapping sync opened
      // notifications until you happened to hit the calendar body instead.
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 0 }}
      accessibilityRole="button"
      accessibilityLabel="Calendar sync"
      style={{ paddingLeft: space.lg }}
    >
      {/* A calendar with sync arrows on it, built from two glyphs because
          Ionicons has no single one. The arrows sit on a disc filled with the
          header's own background so they read as a badge ON the calendar
          rather than as strokes tangled up in its border.

          The box is sized to hold both. The arrows used to be pinned at
          right:-5, bottom:-4, which drew them outside this view and therefore
          outside the button's own touch target: a quarter of what you could see
          was not part of what you could press. Same pixels, now inside. */}
      <View style={{ width: 28, height: 27 }}>
        <Ionicons name="calendar-outline" size={23} color={t.color.text} />
        <View
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 15,
            height: 15,
            borderRadius: 8,
            backgroundColor: t.color.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="sync" size={13} color={t.color.text} />
        </View>
      </View>
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
      // The other half of the pair: no slop on the left, where Sync is. Its own
      // 16px of padding on that side is already a generous target, and taking
      // ten more was only ever taking them from its neighbour.
      hitSlop={{ top: 10, bottom: 10, left: 0, right: 10 }}
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
