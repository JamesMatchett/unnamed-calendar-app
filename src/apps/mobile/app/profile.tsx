import { HANDLE_MAX } from "@calder/core";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, View } from "react-native";

import { Field, PrimaryButton, RowButton, TextField, ToggleRow } from "@/components/form";
import { Card, Muted } from "@/components/ui";
import type { FriendGrants } from "@/db/repo";
import {
  deleteMyProfile,
  getProfile,
  handleAvailable,
  normaliseHandle,
  profileFootprint,
  replayOnboarding,
  updateProfile,
} from "@/db/repo";
import { signOut } from "@/lib/auth";
import { handleHint } from "@/lib/handles";
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

  // normaliseHandle, not a hand-rolled trim. This screen used to strip a
  // leading sigil and nothing else, so it would happily store "James M" or
  // "A/B?c" as a handle — and since the QR link normalises on the way out, a
  // handle stored like that produces a code for &jamesm, which is somebody
  // else, or nobody.
  const trimmedHandle = normaliseHandle(handle);
  const hint = handleHint(handle, !handleAvailable(trimmedHandle), profile.handle);

  const commitName = () => {
    const next = name.trim();
    // An empty name would leave someone as a blank row in every member list, so
    // the field reverts rather than saving nothing.
    if (next.length === 0) return setName(profile.displayName);
    if (next !== profile.displayName) updateProfile({ displayName: next });
  };

  /**
   * Confirmed, never saved on the way past.
   *
   * This used to commit when the field lost focus, and silently put the old
   * handle back if the new one was refused — so the two outcomes of typing
   * looked the same, and the one that did something happened without being
   * asked for. A handle is not a preference: it is an address. It is in the QR
   * code on somebody's phone and in whatever they have already shown people,
   * and all of that stops pointing here the moment it changes. That earns a
   * button and a sentence saying so.
   */
  const confirmHandle = () =>
    Alert.alert(
      `Change your handle to &${trimmedHandle}?`,
      `&${profile.handle} stops being yours, and any code or link you have already shared stops finding you. People who have you as a friend are unaffected.`,
      [
        { text: "Keep &" + profile.handle, style: "cancel" },
        {
          text: "Change it",
          onPress: () => updateProfile({ handle: trimmedHandle }),
        },
      ],
    );

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

        <Field label="Your handle">
          {/* The & is part of the field furniture, not of the value: it can
              never be deleted, and the handle we store and compare never
              carries it. Anything typed with a sigil is quietly cleaned, "@"
              included, because that is what fingers do by habit.

              Nothing is stripped as you type beyond the sigil. A field that
              silently eats the underscore you just pressed is a field you
              cannot tell is working; normaliseHandle has the last word when it
              is saved, and the line underneath shows what will actually be
              stored. */}
          <TextField
            value={handle}
            onChange={setHandle}
            placeholder="handle"
            autoCapitalize="none"
            maxLength={HANDLE_MAX + 4}
            prefix="&"
          />

          <Text
            style={{
              ...type.caption,
              color:
                hint.tone === "bad"
                  ? t.color.danger
                  : hint.tone === "good"
                    ? t.color.success
                    : t.color.textMuted,
            }}
          >
            {hint.message}
          </Text>

          {hint.changed ? (
            <View style={{ gap: space.sm, paddingTop: space.xs }}>
              <PrimaryButton
                label={hint.ok ? `Use &${trimmedHandle}` : "Use this handle"}
                onPress={confirmHandle}
                disabled={!hint.ok}
              />
              <Pressable
                onPress={() => setHandle(profile.handle)}
                accessibilityRole="button"
              >
                <Text
                  style={{
                    ...type.caption,
                    color: t.color.textMuted,
                    textAlign: "center",
                  }}
                >
                  Keep &{profile.handle}
                </Text>
              </Pressable>
            </View>
          ) : null}
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
          {/* Above Delete, and in the app's own colour rather than the danger
              one. They sit together because both are "end this", and they are
              drawn differently because one is reversible in ten seconds and
              the other is not. */}
          <Pressable
            onPress={confirmSignOut}
            accessibilityRole="button"
            style={{
              alignItems: "center",
              paddingVertical: space.lg - 2,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: t.color.border,
              backgroundColor: t.color.surface,
            }}
          >
            <Text style={{ ...type.label, fontSize: 16, color: t.color.text }}>
              Sign out
            </Text>
          </Pressable>

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

  function confirmSignOut() {
    // Said plainly, because the honest answer is surprising: the calendars are
    // on this phone, so signing out does not remove them. Somebody expecting
    // sign-out to clear the device would otherwise hand it over believing it
    // had.
    Alert.alert(
      "Sign out?",
      "Your calendars and events stay on this phone. You will be asked to sign in again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await signOut();
              // The only route back in: signing in lives in the first-run flow,
              // so ending a session means starting that again.
              replayOnboarding();
            })();
          },
        },
      ],
    );
  }

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
