import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import {
  Field,
  PrimaryButton,
  RowButton,
  Segmented,
  TextField,
  ToggleRow,
} from "@/components/form";
import { Cover, CoverPlaceholder } from "@/components/Cover";
import { TimeZonePicker } from "@/components/TimeZonePicker";
import { TravelModePicker } from "@/components/TravelMode";
import { Muted } from "@/components/ui";
import { pickCoverImage } from "@/lib/pickImage";
import { createCalendar, inviteUser } from "@/db/repo";
import type { TravelMode } from "@calder/core";

import { describeZone, deviceTimeZone, offsetLabel } from "@/lib/timezones";
import { space, type, useTheme } from "@/theme";

type Mode = "bounded" | "continuous";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pretty = (s: string) =>
  new Date(`${s}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * Creating a calendar (§3.5).
 *
 * Three decisions and nothing else: what it is called, whether it has dates, and
 * whether to collect arrival and departure. Every extra field costs completions,
 * and a description can be added later by someone who cares.
 *
 * The screen ends by moving straight on rather than dropping the user into an
 * empty calendar — creation is not finished until there is something in it and
 * somebody else to see it.
 */
export default function NewCalendarScreen() {
  const t = useTheme();
  const router = useRouter();
  /**
   * Started from somebody's page. The calendar is private and ongoing by
   * default, named for the two of you, and they are invited the moment it
   * exists: a "you and me" calendar with nobody else in it is the one kind
   * that must not open empty.
   */
  const { with: withUser, withName } = useLocalSearchParams<{
    with?: string;
    withName?: string;
  }>();

  const [name, setName] = useState(withName ? `Me and ${withName}` : "");
  const [mode, setMode] = useState<Mode>(withUser ? "continuous" : "bounded");
  const [tz, setTz] = useState(deviceTimeZone());
  const [collectAvailability, setCollectAvailability] = useState(false);
  const [allowMemberEvents, setAllowMemberEvents] = useState(true);
  const [travelMode, setTravelMode] = useState<TravelMode>("plane");
  const [isPrivate, setIsPrivate] = useState(Boolean(withUser));
  const [coverImage, setCoverImage] = useState<string | null>(null);

  const pickCover = async () => {
    const picked = await pickCoverImage();
    if (picked) setCoverImage(picked);
  };

  const [zonePickerOpen, setZonePickerOpen] = useState(false);

  const today = new Date();
  const inAWeek = new Date(Date.now() + 7 * 86_400_000);
  const [startDate, setStartDate] = useState(iso(today));
  const [endDate, setEndDate] = useState(iso(inAWeek));
  const [picking, setPicking] = useState<"start" | "end" | null>(null);

  const zone = describeZone(tz);
  const valid = name.trim().length > 0 && (mode === "continuous" || endDate >= startDate);

  const submit = () => {
    const calendarId = createCalendar({
      name,
      mode,
      defaultTz: tz,
      allowMemberEvents,
      travelMode,
      isPrivate,
      coverImage,
      collectAvailability: mode === "bounded" ? collectAvailability : false,
      ...(mode === "bounded" ? { startDate, endDate } : {}),
    });

    if (withUser) inviteUser(calendarId, withUser);

    // Replace rather than push: backing out of a calendar you just made should
    // not land you on the form that made it.
    router.replace({
      pathname: "/calendar/[calendarId]",
      params: { calendarId, created: "1" },
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: "New calendar", presentation: "modal" }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Field label="What's it called?">
          <TextField
            value={name}
            onChange={setName}
            /* The example doubles as an explanation of the mode: a dated
               calendar is a trip, an ongoing one is a standing habit. */
            placeholder={
              mode === "bounded" ? "Lisbon Trip 2026" : "London nights out!"
            }
            autoFocus
            maxLength={60}
          />
        </Field>

        <Field
          label="Does it have dates?"
          hintOneLine
          hint={
            mode === "bounded"
              ? "A trip, holiday, festival or weekend with set dates"
              : "Open-ended, for whatever comes up"
          }
        >
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "bounded", label: "Set dates" },
              { value: "continuous", label: "Ongoing" },
            ]}
          />
        </Field>

        {mode === "bounded" ? (
          <View style={{ gap: space.sm }}>
            <RowButton
              label="Starts"
              value={pretty(startDate)}
              onPress={() => setPicking(picking === "start" ? null : "start")}
            />
            <RowButton
              label="Ends"
              value={pretty(endDate)}
              onPress={() => setPicking(picking === "end" ? null : "end")}
            />

            {picking ? (
              <DateTimePicker
                value={new Date(`${picking === "start" ? startDate : endDate}T12:00:00.000Z`)}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                onChange={(_, selected) => {
                  if (Platform.OS !== "ios") setPicking(null);
                  if (!selected) return;
                  const next = iso(selected);
                  if (picking === "start") {
                    setStartDate(next);
                    // An end before the start is not a validation error to
                    // scold someone about — just move it.
                    if (endDate < next) setEndDate(next);
                  } else {
                    setEndDate(next);
                  }
                }}
              />
            ) : null}
          </View>
        ) : null}

        {/* Last of the three, on purpose: the name and the dates decide what the
            calendar IS, and a picture is decoration. Anything optional sitting
            above a question that shapes the rest of the form invites people to
            stop and fiddle with it first. */}
        <Field label="Cover picture">
          {/* The empty frame IS the button. A big obvious placeholder that does
              nothing when tapped, with the only working control a small link
              underneath, is a trap people fall into every time. */}
          <Pressable
            onPress={() => void pickCover()}
            accessibilityRole="button"
            accessibilityLabel={
              coverImage ? "Change the cover picture" : "Choose a cover image"
            }
          >
            {coverImage ? (
              <Cover value={coverImage} height={120} />
            ) : (
              <CoverPlaceholder label="Choose a cover image" height={120} />
            )}
          </Pressable>
        </Field>

        <View style={{ flexDirection: "row", gap: space.lg, marginTop: -space.md }}>
          <Pressable onPress={() => void pickCover()} accessibilityRole="button">
            <Text style={{ ...type.caption, color: t.color.accent }}>
              {coverImage ? "Change picture" : "Choose a picture"}
            </Text>
          </Pressable>
          {coverImage ? (
            <Pressable
              onPress={() => setCoverImage(null)}
              accessibilityRole="button"
            >
              <Text style={{ ...type.caption, color: t.color.textMuted }}>
                Remove
              </Text>
            </Pressable>
          ) : null}
        </View>


        <Field
          label="What time zone are you on?"
          hint="Events default to this, not your phone's, so a trip abroad doesn't quietly schedule in UK time."
        >
          <RowButton
            label={zone.region ? `${zone.city} · ${zone.region}` : zone.city}
            value={offsetLabel(tz)}
            onPress={() => setZonePickerOpen(true)}
          />
        </Field>

        <ToggleRow
          label="Keep this private"
          hint="For your own plans, or something just you and one other person share."
          value={isPrivate}
          onChange={setIsPrivate}
        />

        <ToggleRow
          label="Let anyone add events"
          hint="Off makes it a calendar you curate, so only owners can add things."
          value={allowMemberEvents}
          onChange={setAllowMemberEvents}
        />

        {mode === "bounded" ? (
          <View style={{ gap: space.sm }}>
            <ToggleRow
              label="Ask when people arrive and leave"
              hint="Useful when everyone turns up at different times. Not so useful for a night out at home."
              value={collectAvailability}
              onChange={setCollectAvailability}
            />

            {/* Only meaningful once arrivals are being collected, so it appears
                with them rather than sitting inert above. */}
            {collectAvailability ? (
              <Field label="How are people getting there?">
                <TravelModePicker value={travelMode} onChange={setTravelMode} />
              </Field>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <PrimaryButton label="Create" onPress={submit} disabled={!valid} />
          <Text style={{ ...type.caption, color: t.color.textMuted, textAlign: "center" }}>
            You'll add the first thing next, then invite people.
          </Text>
        </View>

        <Muted>You can change any of this later.</Muted>
      </ScrollView>

      <TimeZonePicker
        visible={zonePickerOpen}
        current={tz}
        onSelect={setTz}
        onClose={() => setZonePickerOpen(false)}
      />
    </>
  );
}
