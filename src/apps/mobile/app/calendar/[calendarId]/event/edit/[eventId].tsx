import DateTimePicker from "@react-native-community/datetimepicker";
import { canEditEvent, zonedWallToUtc } from "@calder/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";

import {
  Field,
  PrimaryButton,
  RowButton,
  Segmented,
  TextField,
  ToggleRow,
} from "@/components/form";
import { Cover, CoverPlaceholder } from "@/components/Cover";
import { EmptyState, Muted } from "@/components/ui";
import {
  getCalendar,
  getEvent,
  myMembership,
  setEventCancelled,
  updateEvent,
} from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { formatDayShort } from "@/lib/format";
import { pickCoverImage } from "@/lib/pickImage";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

type Precision = "datetime" | "date" | "tbc";

/**
 * Edit an event (§8.1).
 *
 * Deliberately NOT the add form with a different button. Adding is a fast,
 * forgiving flow built around one line of typed text; editing is a careful one,
 * where every field already has a value someone chose and the natural-language
 * box would only invite the parser to overwrite them. Same fields, different job.
 *
 * Permission is checked here as well as at the pencil, because a route can be
 * reached directly and a screen that trusts its caller is a screen that will one
 * day be wrong.
 */
export default function EditEventScreen() {
  const t = useTheme();
  const router = useRouter();
  const { calendarId, eventId } = useLocalSearchParams<{
    calendarId: string;
    eventId: string;
  }>();

  const event = useQuery(`event:${eventId}`, () => getEvent(eventId));
  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const me = useQuery(`me:${calendarId}`, () => myMembership(calendarId));

  const tz = event?.tz ?? calendar?.default_tz ?? "Europe/London";

  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [precision, setPrecision] = useState<Precision>(
    (event?.precision as Precision) ?? "datetime",
  );
  const [date, setDate] = useState(
    event?.local_wall?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [time, setTime] = useState(event?.local_wall?.slice(11, 16) ?? "19:00");
  const [location, setLocation] = useState(event?.location_name ?? "");
  const [ticketsRequired, setTicketsRequired] = useState(
    event?.tickets_required === 1,
  );
  const [ticketUrl, setTicketUrl] = useState(event?.ticket_url ?? "");
  const [imageKey, setImageKey] = useState<string | null>(event?.image_key ?? null);
  const [picking, setPicking] = useState<"date" | "time" | null>(null);

  const pickImage = async () => {
    const picked = await pickCoverImage();
    if (picked) setImageKey(picked);
  };

  if (!event) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit", presentation: "modal" }} />
        <EmptyState title="Event not found" body="It may have been deleted." />
      </>
    );
  }

  const allowed = canEditEvent({
    createdBy: event.created_by,
    userId: CURRENT_USER_ID,
    role: me?.role ?? null,
    status: event.status,
  });

  if (!allowed) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit", presentation: "modal" }} />
        <EmptyState
          title="Not yours to change"
          body="You can suggest a change instead, and whoever owns the calendar decides."
        />
      </>
    );
  }

  const valid = title.trim().length > 0;
  const wall = `${date}T${precision === "datetime" ? time : "12:00"}:00`;

  const save = () => {
    updateEvent(event.event_id, {
      title,
      description: description || null,
      startUtc: zonedWallToUtc(wall, tz),
      tz,
      localWall: wall,
      precision,
      locationName: location || null,
      ticketsRequired,
      ticketUrl: ticketsRequired ? ticketUrl : null,
      imageKey,
    });
    router.back();
  };

  const cancelEvent = () => {
    Alert.alert(
      `Call off ${event.title}?`,
      "It stays on the calendar, struck through, so nobody turns up. You can bring it back.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Call it off",
          style: "destructive",
          onPress: () => {
            setEventCancelled(event.event_id, true);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: "Edit event", presentation: "modal" }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Field label="Called">
          <TextField
            value={title}
            onChange={setTitle}
            placeholder="What's happening"
            maxLength={80}
          />
        </Field>

        <Field label="When">
          <Segmented<Precision>
            value={precision}
            onChange={setPrecision}
            options={[
              { value: "datetime", label: "At a time" },
              { value: "date", label: "All day" },
              { value: "tbc", label: "TBC" },
            ]}
          />
        </Field>

        <View style={{ gap: space.sm }}>
          <RowButton
            label="Date"
            value={formatDayShort(date, tz)}
            onPress={() => setPicking(picking === "date" ? null : "date")}
          />
          {precision === "datetime" ? (
            <RowButton
              label="Time"
              value={time}
              onPress={() => setPicking(picking === "time" ? null : "time")}
            />
          ) : null}

          {picking ? (
            <DateTimePicker
              value={new Date(`${date}T${time}:00`)}
              mode={picking}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(_, selected) => {
                if (Platform.OS !== "ios") setPicking(null);
                if (!selected) return;
                if (picking === "date") {
                  setDate(selected.toISOString().slice(0, 10));
                } else {
                  setTime(
                    `${String(selected.getHours()).padStart(2, "0")}:${String(
                      selected.getMinutes(),
                    ).padStart(2, "0")}`,
                  );
                }
              }}
            />
          ) : null}

          <Muted>Times are in the calendar's zone, {tz}.</Muted>
        </View>

        <Field label="Where">
          <TextField
            value={location}
            onChange={setLocation}
            placeholder="Somewhere, or leave it blank"
            maxLength={80}
          />
        </Field>

        <Field label="Anything else">
          <TextField
            value={description}
            onChange={setDescription}
            placeholder="Notes, links, what to bring"
            maxLength={280}
          />
        </Field>

        <ToggleRow
          label="Tickets needed"
          value={ticketsRequired}
          onChange={setTicketsRequired}
        />

        {ticketsRequired ? (
          <Field label="Where to get them">
            <TextField
              value={ticketUrl}
              onChange={setTicketUrl}
              placeholder="https://"
              autoCapitalize="none"
            />
          </Field>
        ) : null}


        {/* Only ever seen on the event's own screen, never in a list: a row of
            photographs is a feed, and a day's plans read faster as text. The
            picture is for when you have opened the thing to decide about it. */}
        <Field
          label={imageKey ? "Photo" : "Add a photo"}
          hintOneLine
          hint="Shown when someone opens the event"
        >
          <Pressable
            onPress={() => void pickImage()}
            accessibilityRole="button"
            accessibilityLabel={imageKey ? "Change the picture" : "Choose a picture"}
          >
            {imageKey ? (
              <Cover value={imageKey} height={110} />
            ) : (
              <CoverPlaceholder label="Choose a picture" height={110} />
            )}
          </Pressable>
        </Field>

        {imageKey ? (
          <Pressable
            onPress={() => setImageKey(null)}
            accessibilityRole="button"
            style={{ marginTop: -space.md }}
          >
            <Text style={{ ...type.caption, color: t.color.textMuted }}>
              Remove picture
            </Text>
          </Pressable>
        ) : null}

        <PrimaryButton label="Save changes" onPress={save} disabled={!valid} />

        {/* Calling it off lives here rather than on the event, where it would sit
            next to the RSVP buttons and get tapped by mistake. */}
        <Pressable onPress={cancelEvent} accessibilityRole="button">
          <Text
            style={{
              ...type.label,
              color: t.color.danger,
              textAlign: "center",
              paddingVertical: space.md,
            }}
          >
            Call this event off
          </Text>
        </Pressable>

        {event.updated_by && event.updated_at ? (
          <Muted>
            Last changed {formatDayShort(event.updated_at.slice(0, 10), tz)}.
          </Muted>
        ) : null}
      </ScrollView>
    </>
  );
}
