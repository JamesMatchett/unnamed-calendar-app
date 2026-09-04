import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, View } from "react-native";

import { Field, RowButton, TextField, ToggleRow } from "@/components/form";
import { Card, Muted } from "@/components/ui";
import type { FriendGrants } from "@/db/repo";
import {
  deleteMyProfile,
  getProfile,
  handleAvailable,
  profileFootprint,
  updateProfile,
} from "@/db/repo";
import { pickCoverImage } from "@/lib/pickImage";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Me: how I appear to everyone else, and what they can see of me (§7.2, §7.4).
 *
 * Separate from Settings, which is about how this device draws things. The
 * split is the useful one: nothing here is private to this phone, and nothing
 * in Settings is visible to anybody else.
 */
export default function ProfileScreen() {
  const t = useTheme();
  const router = useRouter();

  const profile = useQuery("profile", () => getProfile());
  const [name, setName] = useState(profile.displayName);
  const [handle, setHandle] = useState(profile.handle);

  const trimmedHandle = handle.trim().replace(/^[&@]+/, "");
  const handleTaken =
    trimmedHandle.length > 0 && !handleAvailable(trimmedHandle);

  const commitName = () => {
    const next = name.trim();
    // An empty name would leave someone as a blank row in every member list, so
    // the field reverts rather than saving nothing.
    if (next.length === 0) return setName(profile.displayName);
    if (next !== profile.displayName) updateProfile({ displayName: next });
  };

  const commitHandle = () => {
    if (trimmedHandle.length === 0 || handleTaken) return setHandle(profile.handle);
    if (trimmedHandle !== profile.handle) updateProfile({ handle: trimmedHandle });
  };

  const pickAvatar = async () => {
    const picked = await pickCoverImage();
    if (picked) updateProfile({ avatar: picked });
  };

  return (
    <>
      {/* Settings in the corner, the same gear as everywhere else. Profile and
          Settings are neighbours in people's heads even though the split is
          real: this is who you are, that is how the app behaves. The row lower
          down still links there for anyone reading top to bottom. */}
      <Stack.Screen
        options={{
          title: "Your profile",
          presentation: "modal",
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/settings")}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="App settings"
            >
              <Ionicons name="settings-outline" size={22} color={t.color.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", gap: space.sm }}>
          <Pressable
            onPress={() => void pickAvatar()}
            accessibilityRole="button"
            accessibilityLabel={
              profile.avatar ? "Change your picture" : "Add a picture"
            }
          >
            {profile.avatar ? (
              <Image
                source={{ uri: profile.avatar }}
                accessibilityIgnoresInvertColors
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: t.color.surfaceAlt,
                }}
              />
            ) : (
              <View
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: t.color.surfaceAlt,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ ...type.title, color: t.color.textMuted }}>
                  {initial(profile.displayName)}
                </Text>
              </View>
            )}
          </Pressable>

          <View style={{ flexDirection: "row", gap: space.lg }}>
            <Pressable onPress={() => void pickAvatar()} accessibilityRole="button">
              <Text style={{ ...type.caption, color: t.color.accent }}>
                {profile.avatar ? "Change picture" : "Add a picture"}
              </Text>
            </Pressable>
            {profile.avatar ? (
              <Pressable
                onPress={() => updateProfile({ avatar: null })}
                accessibilityRole="button"
              >
                <Text style={{ ...type.caption, color: t.color.textMuted }}>
                  Remove
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <Field label="Your name" hint="What people see on events you add and in member lists.">
          <TextField
            value={name}
            onChange={setName}
            onBlur={commitName}
            placeholder="Your name"
            maxLength={40}
          />
        </Field>

        <Field
          label="Your handle"
          hint={
            handleTaken
              ? "That one is taken. Try another."
              : "How friends find you: &jamesm. Letters, numbers and dots."
          }
        >
          {/* The & is part of the field furniture, not of the value: it can
              never be deleted, and the handle we store and compare never
              carries it. Anything typed with a sigil is quietly cleaned, "@"
              included, because that is what fingers do by habit. */}
          <TextField
            value={handle}
            onChange={(next) => setHandle(next.replace(/[^A-Za-z0-9.]/g, ""))}
            onBlur={commitHandle}
            placeholder="handle"
            autoCapitalize="none"
            maxLength={20}
            prefix="&"
          />
        </Field>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Who can see you
          </Text>

          <ToggleRow
            label="Let people find me"
            hint="Off means only people you already share a calendar with can search for you."
            value={profile.discoverable}
            onChange={(next) => updateProfile({ discoverable: next })}
          />

          {/* The default is what a new friend gets before I think about it, so
              it is the setting that actually decides what most people see. */}
          <RowButton
            label="New friends see"
            value={GRANT_LABEL[profile.defaultGrants]}
            onPress={() => cycleGrants(profile.defaultGrants)}
          />
          <Muted>
            You can change this for any one friend on their own page.
          </Muted>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>People</Text>
          <Card style={{ gap: 0 }}>
            {/* One destination, not two: friends, requests and invitations are
                all the same screen now. */}
            <Row
              icon="people-outline"
              label="Friends, invites and requests"
              onPress={() => router.push("/people")}
            />
            <Row
              icon="options-outline"
              label="App settings"
              onPress={() => router.push("/settings")}
            />
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            Your account
          </Text>
          <Pressable
            onPress={confirmDelete}
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
              Delete your profile
            </Text>
          </Pressable>
          <Muted>
            Events you added stay on other people's calendars, shown as added by
            a former member. Everything that identifies you is removed.
          </Muted>
        </View>
      </ScrollView>
    </>
  );

  function cycleGrants(current: FriendGrants) {
    const order: FriendGrants[] = ["none", "busy", "full"];
    const next = order[(order.indexOf(current) + 1) % order.length] ?? "none";
    updateProfile({ defaultGrants: next });
  }

  /**
   * The footprint comes first, then the confirmation.
   *
   * "You are the only owner of Lisbon, October" is the fact that changes
   * someone's mind, and learning it afterwards is learning it too late (§8.5).
   */
  function confirmDelete() {
    const f = profileFootprint();
    const lines = [
      `${f.calendars} ${f.calendars === 1 ? "calendar" : "calendars"}, ${f.events} ${f.events === 1 ? "event" : "events"} you added, ${f.friends} ${f.friends === 1 ? "friend" : "friends"}.`,
    ];

    if (f.soleOwnerOf.length > 0) {
      lines.push(
        `You are the only owner of ${listNames(f.soleOwnerOf)}. Hand ${f.soleOwnerOf.length === 1 ? "it" : "them"} to someone else first, or ${f.soleOwnerOf.length === 1 ? "it goes" : "they go"} with you.`,
      );
    }

    Alert.alert("Delete your profile?", lines.join("\n\n"), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteMyProfile();
          router.dismissAll();
          router.replace("/");
        },
      },
    ]);
  }
}

function Row({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.md,
      }}
    >
      <Ionicons name={icon} size={19} color={t.color.textMuted} />
      <Text style={{ ...type.body, flex: 1, color: t.color.text }}>{label}</Text>
      <Ionicons name="chevron-forward" size={17} color={t.color.textMuted} />
    </Pressable>
  );
}

const GRANT_LABEL: Record<FriendGrants, string> = {
  none: "Nothing",
  busy: "When you're free",
  full: "Your full calendar",
};

const initial = (name: string): string =>
  name.trim().charAt(0).toUpperCase() || "?";

const listNames = (names: readonly string[]): string =>
  names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
