import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { Card, Muted } from "@/components/ui";
import { getProfile } from "@/db/repo";
import { APP_INVITE_URL, friendUrl, shareLink } from "@/lib/share";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Your own code (§7.3).
 *
 * The same shape as the calendar invite screen on purpose: a code to point a
 * camera at when you are stood next to somebody, and a share sheet for
 * everybody else. Those are two genuinely different situations and the reason
 * this screen exists at all is that only the second was covered before, which
 * meant the commonest way people actually swap details — being in the same room
 * — went through a text message.
 *
 * One code, not one per person, and it does not expire. It is your handle,
 * which is already how anybody finds you in search: a rotating token would
 * imply a secret this does not contain, and would break every printed or
 * screenshotted copy for no benefit.
 */
export default function ConnectScreen() {
  const t = useTheme();
  const profile = useQuery("profile", () => getProfile());

  const handle = profile.handle.trim();
  const ready = handle.length > 0;
  const url = ready ? friendUrl(handle, profile.displayName) : APP_INVITE_URL;

  const share = () =>
    void shareLink({
      text: ready
        ? `Add me on Cal&der, I'm &${handle}`
        : "Cal&der is a shared calendar for making plans with people.",
      url,
      subject: "Cal&der",
    });

  return (
    <>
      <Stack.Screen options={{ title: "Your code" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <View style={{ alignItems: "center", gap: space.md }}>
          <Text style={{ ...type.title, color: t.color.text, textAlign: "center" }}>
            {profile.displayName}
          </Text>
          {ready ? (
            <Text style={{ ...type.body, color: t.color.textMuted }}>&{handle}</Text>
          ) : null}

          <View
            style={{
              padding: space.lg,
              backgroundColor: "#fff",
              borderRadius: radius.lg,
            }}
          >
            {/* Always on white whatever the theme: a dark-mode QR with an
                inverted quiet zone is unreadable to most scanners. */}
            <QRCode value={url} size={220} backgroundColor="#fff" color="#000" />
          </View>

          <Muted>
            {ready
              ? "Point a camera at this to add me"
              : "Point a camera at this to get the app"}
          </Muted>
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

          <Card>
            <Text selectable style={{ ...type.caption, color: t.color.textMuted }}>
              {url}
            </Text>
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>
            What happens when somebody scans it
          </Text>
          <Card style={{ gap: space.sm }}>
            <Row
              icon="phone-portrait-outline"
              text="If they have Cal&der, it opens on your profile with an add button."
            />
            <Row
              icon="download-outline"
              text="If they haven't, it takes them to the page that installs it, and finds you afterwards."
            />
            <Row
              icon="lock-open-outline"
              text="Your handle is all this carries. It shows nothing about your calendars, and nobody is added until you both agree."
            />
          </Card>
        </View>
      </ScrollView>
    </>
  );
}

function Row({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={17} color={t.color.textMuted} style={{ marginTop: 1 }} />
      <Text style={{ ...type.caption, color: t.color.text, flex: 1 }}>{text}</Text>
    </View>
  );
}
