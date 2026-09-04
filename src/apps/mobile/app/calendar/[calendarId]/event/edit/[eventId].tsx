import { canEditEvent, zonedWallToUtc } from "@calder/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import {
  Field,
  PrimaryButton,
  RowButton,
  Segmented,
  SegmentedGroup,
  TextField,
  ToggleRow,
} from "@/components/form";
import { Cover, CoverPlaceholder } from "@/components/Cover";
import { SlotDialog } from "@/components/SlotDialog";
import { EmptyState, Group, Muted } from "@/components/ui";
import {
  getCalendar,
  getEvent,
  myMembership,
  proposeSlot,
  startPoll,
  setEventCancelled,
  updateEvent,
} from "@/db/repo";
import { CURRENT_USER_ID } from "@/db/seed";
import { formatDayShort } from "@/lib/format";
import { pickCoverImage } from "@/lib/pickImage";
import { useQuery } from "@/lib/useQuery";
import { space, type, useTheme } from "@/theme";

const clockIn = (instant: string, tz: string): string =>
  new Date(instant).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  });

const nextDay = (iso: string): string =>
  new Date(new Date(`${iso}T12:00:00.000Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);

type Precision = "datetime" | "date" | "tbc";

/** Same three choices as the add form. "ask" means tbc with a poll running. */
type When = "datetime" | "date" | "ask";

const WHEN_OPTIONS: { value: When; label: string }[] = [
  { value: "datetime", label: "At a time" },
  { value: "date", label: "All day" },
  { value: "ask", label: "Poll" },
];

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
  /** Optional. Absent means "it finishes when it finishes", not midnight. */
  const [endTime, setEndTime] = useState<string | null>(
    event?.end_utc ? clockIn(event.end_utc, event.tz) : null,
  );
  const [location, setLocation] = useState(event?.location_name ?? "");
  const [ticketsRequired, setTicketsRequired] = useState(
    event?.tickets_required === 1,
  );
  const [ticketUrl, setTicketUrl] = useState(event?.ticket_url ?? "");
  const [imageKey, setImageKey] = useState<string | null>(event?.image_key ?? null);
  const [pickingWhen, setPickingWhen] = useState(false);
  const [openSuggestions, setOpenSuggestions] = useState(
    event?.scheduling_mode !== "proposed",
  );

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
    /**
     * Switching to Ask opens a poll and seeds it with the date the event
     * already had, so there is something to answer immediately. Switching away
     * settles the event on whatever the form now says: the slots and votes stay
     * on record, because how a date was chosen is worth keeping (§8.1).
     */
    const asking = precision === "tbc";
    if (asking && event.scheduling_mode === "fixed") {
      startPoll(event.event_id, openSuggestions ? "open" : "proposed");
      proposeSlot(event.event_id, {
        startUtc: zonedWallToUtc(wall, tz),
        tz,
        localWall: wall,
        precision: "datetime",
      });
    } else if (asking) {
      startPoll(event.event_id, openSuggestions ? "open" : "proposed");
    } else if (event.scheduling_mode !== "fixed") {
      startPoll(event.event_id, "fixed");
    }

    // An end before the start belongs to the next morning: a gig finishing at
    // 01:00 has not gone backwards.
    const endWall =
      precision === "datetime" && endTime
        ? `${endTime < time ? nextDay(date) : date}T${endTime}:00`
        : null;

    updateEvent(event.event_id, {
      title,
      description: description || null,
      startUtc: zonedWallToUtc(wall, tz),
      endUtc: endWall ? zonedWallToUtc(endWall, tz) : null,
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
          <SegmentedGroup>
            <Segmented<When>
              bare
              value={precision === "tbc" ? "ask" : precision}
              onChange={(next) => setPrecision(next === "ask" ? "tbc" : next)}
              options={WHEN_OPTIONS}
            />
            {precision === "tbc" ? (
              <Segmented<"open" | "proposed">
                bare
                value={openSuggestions ? "open" : "proposed"}
                onChange={(next) => setOpenSuggestions(next === "open")}
                options={[
                  { value: "open", label: "Anyone can suggest" },
                  { value: "proposed", label: "Only my options" },
                ]}
              />
            ) : null}
          </SegmentedGroup>
        </Field>

        {precision === "tbc" ? (
          <View style={{ gap: space.sm }}>
            <Muted>
              {event.scheduling_mode === "fixed"
                ? "The date below becomes the first thing people can answer."
                : "People are answering on the event screen."}
            </Muted>
          </View>
        ) : null}

        {/* One sheet for the whole of when, the same one the create screen
            opens. The picker used to unfold inline under these rows while the
            end time had a second, identical-looking sheet of its own, which
            left two ways to change a date on screen and no way to tell the two
            sheets apart. */}
        <View style={{ gap: space.sm }}>
          <Group>
            <RowButton
              bare
              label="Date"
              value={formatDayShort(date, tz)}
              onPress={() => setPickingWhen(true)}
            />
            {precision === "datetime" ? (
              <RowButton
                bare
                label="Time"
                value={
                  endTime
                    ? `${time} to ${endTime}${endTime < time ? " next day" : ""}`
                    : time
                }
                onPress={() => setPickingWhen(true)}
              />
            ) : null}
          </Group>

          <Muted>Times are in the calendar's zone, {tz}.</Muted>
        </View>

        <SlotDialog
          visible={pickingWhen}
          initial={{ date, time, endTime }}
          tz={tz}
          title="When is it?"
          saveLabel="Set time"
          dateLabel="On"
          timeLabel="Starts"
          withTime={precision === "datetime"}
          withEnd={precision === "datetime"}
          onSave={(draft) => {
            setDate(draft.date);
            if (precision === "datetime") {
              setTime(draft.time);
              setEndTime(draft.endTime ?? null);
            }
          }}
          onClose={() => setPickingWhen(false)}
        />

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
