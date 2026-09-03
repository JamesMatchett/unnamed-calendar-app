import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { parseEventText, zonedWallToUtc } from "@calder/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
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
import { Card, EmptyState, Muted } from "@/components/ui";
import {
  createEvent,
  findSimilarEvents,
  getCalendar,
  myMembership,
} from "@/db/repo";
import { formatClock } from "@/lib/format";
import { pickCoverImage } from "@/lib/pickImage";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

type Precision = "datetime" | "date" | "tbc";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const prettyDate = (s: string) =>
  new Date(`${s}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/**
 * Adding an event (§3.5).
 *
 * Creation is a speed problem, not a form problem: every field a person has to
 * fill in reduces the number of events that get created, and an empty shared
 * calendar is a dead one. So the whole thing is driven by one line of text, and
 * everything below it is a correction rather than an entry.
 */
export default function NewEventScreen() {
  const t = useTheme();
  const router = useRouter();
  const { calendarId } = useLocalSearchParams<{ calendarId: string }>();

  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const me = useQuery(`me:${calendarId}`, () => myMembership(calendarId));

  const tz = calendar?.default_tz ?? "Europe/London";

  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState("");
  /**
   * Today, unless today is not part of this calendar.
   *
   * A trip in October defaulting to today put every new event outside the trip,
   * where the day list did not draw it: the event saved and vanished. Clamping
   * into the range means the default is always a day the calendar actually has,
   * and the picker still allows any date for the odd thing that genuinely sits
   * outside.
   */
  const [date, setDate] = useState(() => {
    const today = isoDate(new Date());
    if (calendar?.mode !== "bounded") return today;
    const first = calendar.start_date;
    const last = calendar.end_date;
    if (!first || !last) return today;
    return today < first ? first : today > last ? last : today;
  });
  const [time, setTime] = useState<string | null>(null);
  const [precision, setPrecision] = useState<Precision>("datetime");
  const [location, setLocation] = useState("");
  const [ticketsRequired, setTicketsRequired] = useState(false);
  const [ticketUrl, setTicketUrl] = useState("");
  const [imageKey, setImageKey] = useState<string | null>(null);

  const pickImage = async () => {
    const picked = await pickCoverImage();
    if (picked) setImageKey(picked);
  };
  const [picking, setPicking] = useState<"date" | "time" | null>(null);
  const [touched, setTouched] = useState(false);

  /**
   * The parse runs on every keystroke and only fills fields the person has not
   * touched, so correcting one thing never has it overwritten by the next
   * character typed.
   */
  const onRawChange = (next: string) => {
    setRaw(next);
    if (touched) return;

    const parsed = parseEventText(next, tz);
    setTitle(parsed.title);
    if (parsed.date) setDate(parsed.date);
    if (parsed.time) setTime(parsed.time);
    if (parsed.location) setLocation(parsed.location);

    // Only when the text SAYS something about timing. "all day" and "TBC" are
    // how people write it, and both are states the control already has, so
    // typing them should move it rather than leaving the words stranded in the
    // title. A null means nothing was said, which must not overwrite a choice
    // made by hand.
    if (parsed.precision) setPrecision(parsed.precision);
  };

  const startUtc = useMemo(
    () => zonedWallToUtc(`${date}T${time ?? "12:00"}:00`, tz),
    [date, time, tz],
  );

  const similar = useQuery(`similar:${calendarId}:${title}:${date}`, () =>
    title.trim().length > 3 ? findSimilarEvents(calendarId, title, startUtc) : [],
  );

  if (!calendar || !me) {
    return <EmptyState title="Not found" body="This calendar is no longer available." />;
  }

  // Contributing and editing someone else's contribution are separate
  // permissions (§8.1), so a curated calendar blocks members here only.
  const mayAdd = me.role === "owner" || calendar.allow_member_events === 1;
  if (!mayAdd) {
    return (
      <>
        <Stack.Screen options={{ title: "Add an event", presentation: "modal" }} />
        <EmptyState
          title="Only owners can add here"
          body={`${calendar.name} is set up so that only its owners add events. Ask one of them, or suggest it another way.`}
        />
      </>
    );
  }

  const valid = title.trim().length > 0;

  const submit = () => {
    const effectiveTime = precision === "datetime" ? (time ?? "19:00") : "12:00";
    createEvent(calendarId, {
      title,
      startUtc: zonedWallToUtc(`${date}T${effectiveTime}:00`, tz),
      tz,
      localWall: `${date}T${effectiveTime}:00`,
      precision,
      locationName: location || null,
      ticketsRequired,
      ticketUrl: ticketsRequired ? ticketUrl : null,
      imageKey,
    });
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: "Add an event", presentation: "modal" }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label="What's happening?"
          hint="Try: Drinks at The Crown Thursday 8pm"
        >
          <TextField
            value={raw}
            onChange={onRawChange}
            placeholder="Dinner at Time Out Market Friday 8pm"
            autoFocus
          />
        </Field>

        {similar.length > 0 ? (
          /* Two people adding the same gig is the most common annoyance in a
             shared calendar, so it is caught while typing rather than cleaned
             up later. */
          <Card style={{ gap: space.xs, borderColor: t.color.maybe }}>
            <Text style={{ ...type.label, color: t.color.maybe }}>
              Already on this calendar?
            </Text>
            {similar.map((e) => (
              <Muted key={e.event_id}>
                {e.title}, {prettyDate(e.start_utc.slice(0, 10))}
              </Muted>
            ))}
          </Card>
        ) : null}

        <Field label="Called">
          <TextField
            value={title}
            onChange={(v) => {
              setTouched(true);
              setTitle(v);
            }}
            placeholder="Event name"
            maxLength={80}
          />
        </Field>

        <Field label="When">
          <Segmented<Precision>
            value={precision}
            onChange={(p) => {
              setTouched(true);
              setPrecision(p);
            }}
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
            value={prettyDate(date)}
            onPress={() => setPicking(picking === "date" ? null : "date")}
          />
          {precision === "datetime" ? (
            <RowButton
              label="Time"
              value={time ? formatClock(`${startUtc}`, tz) : "Pick a time"}
              onPress={() => setPicking(picking === "time" ? null : "time")}
            />
          ) : null}

          {picking ? (
            <DateTimePicker
              value={new Date(startUtc)}
              mode={picking}
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={(_, selected) => {
                if (Platform.OS !== "ios") setPicking(null);
                if (!selected) return;
                setTouched(true);
                if (picking === "date") {
                  setDate(isoDate(selected));
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
            onChange={(v) => {
              setTouched(true);
              setLocation(v);
            }}
            placeholder="Somewhere, or leave it blank"
            maxLength={80}
          />
        </Field>

        <View style={{ gap: space.sm }}>
          <ToggleRow
            label="Tickets needed"
            value={ticketsRequired}
            onChange={setTicketsRequired}
          />
          {ticketsRequired ? (
            <TextField
              value={ticketUrl}
              onChange={setTicketUrl}
              placeholder="Link to tickets"
            />
          ) : null}
        </View>


        {/* Only ever seen on the event's own screen, never in a list: a row of
            photographs is a feed, and a day's plans read faster as text. The
            picture is for when you have opened the thing to decide about it. */}
        <Field label="Picture" hintOneLine hint="Shown when someone opens the event">
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

        <PrimaryButton label="Add to calendar" onPress={submit} disabled={!valid} />
      </ScrollView>
    </>
  );
}
