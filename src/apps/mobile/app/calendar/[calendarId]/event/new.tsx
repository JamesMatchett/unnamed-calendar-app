import { Ionicons } from "@expo/vector-icons";
import { parseEventText, zonedWallToUtc } from "@calder/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import {
  PrimaryButton,
  RowButton,
  Segmented,
  SegmentedGroup,
  TextField,
  ToggleRow,
} from "@/components/form";
import { Chips } from "@/components/Chips";
import { PlaceDialog } from "@/components/PlaceDialog";
import type { Chip } from "@/components/Chips";
import { Cover } from "@/components/Cover";
import type { SlotDraft } from "@/components/SlotDialog";
import { SlotDialog } from "@/components/SlotDialog";
import { Card, EmptyState, Group, Muted } from "@/components/ui";
import {
  createEvent,
  proposeSlot,
  sendEventInvite,
  startPoll,
  findSimilarEvents,
  getCalendar,
  getProfile,
  myMembership,
} from "@/db/repo";
import { formatClock } from "@/lib/format";
import { pickCoverImage } from "@/lib/pickImage";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

type Precision = "datetime" | "date" | "tbc";

/** The parts of the form the sentence can fill in, and a person can overrule. */
type Field = "title" | "date" | "time" | "location" | "precision";

/** What the When control offers. "ask" stores as tbc plus a running poll. */
type When = "datetime" | "date" | "ask";

const WHEN_OPTIONS: { value: When; label: string }[] = [
  { value: "datetime", label: "At a time" },
  { value: "date", label: "All day" },
  // "Poll" is what TBC always meant. As a label it named a state and offered
  // nothing to do about it; as a mode it puts the date to the group and gives
  // the event a way out of being undated. The value stays "ask" internally
  // because that is the verb the code performs.
  { value: "ask", label: "Poll" },
];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

const nextDay = (iso: string): string =>
  new Date(new Date(`${iso}T12:00:00.000Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);

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
  /**
   * `on` and `at` prefill the form. They come from the catch-up finder, which
   * has already worked out a time that suits two people: dropping them here and
   * making the person type it again would throw away the only hard part.
   */
  const { calendarId, on, at, with: withName, invite } = useLocalSearchParams<{
    calendarId: string;
    on?: string;
    at?: string;
    with?: string;
    /** Somebody to ask to this, once it exists. Their user id. */
    invite?: string;
  }>();

  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const me = useQuery(`me:${calendarId}`, () => myMembership(calendarId));

  const tz = calendar?.default_tz ?? "Europe/London";

  /**
   * Named for both of you, not "catch up with them": the same event sits in
   * two calendars once they say yes, and a title that reads correctly from
   * either side is the one that does not need editing on theirs.
   */
  const suggested = withName
    ? `${firstName(getProfile().displayName)} and ${withName} catch up`
    : "";
  const [raw, setRaw] = useState(suggested);
  const [title, setTitle] = useState(suggested);
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
    if (on) return on;
    const today = isoDate(new Date());
    if (calendar?.mode !== "bounded") return today;
    const first = calendar.start_date;
    const last = calendar.end_date;
    if (!first || !last) return today;
    return today < first ? first : today > last ? last : today;
  });
  const [time, setTime] = useState<string | null>(at ?? null);
  const [precision, setPrecision] = useState<Precision>("datetime");
  const [location, setLocation] = useState("");
  const [ticketsRequired, setTicketsRequired] = useState(false);
  const [ticketUrl, setTicketUrl] = useState("");
  const [imageKey, setImageKey] = useState<string | null>(null);
  /**
   * Asking turns the date into a starting point rather than a decision. The
   * event is still created with a time — an event with no time cannot be placed
   * in a list — and that time becomes the poll's first candidate, so people
   * answer about a real evening rather than the abstract idea of meeting up.
   */
  const [openSuggestions, setOpenSuggestions] = useState(true);
  /**
   * Candidate times, held here until the event exists.
   *
   * An organiser who has picked "poll" usually has two or three evenings in
   * mind already; making them create the event first and then go and find it to
   * add times is a detour through a screen they have just left. Stored as local
   * wall readings and converted on submit, exactly as the single date is.
   */
  const [slots, setSlots] = useState<SlotDraft[]>([]);

  const [editingName, setEditingName] = useState(false);
  const [pickingWhen, setPickingWhen] = useState(false);
  /**
   * Optional, and off by default.
   *
   * Most social plans have no end anyone would commit to — dinner finishes when
   * it finishes — so asking for one on every event is a field people skip and a
   * false precision when they do not. It earns its place where it matters: a
   * gig with doors and a curfew, an hour of five-a-side, anything someone has
   * to leave for. The landscape hour grid draws real durations from it; without
   * one it assumes an hour, which is a guess rather than a claim.
   */
  const [endTime, setEndTime] = useState<string | null>(null);
  const [pickingPlace, setPickingPlace] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SlotDraft | null>(null);

  const byTime = (a: SlotDraft, b: SlotDraft) =>
    `${a.date}T${a.time}` < `${b.date}T${b.time}` ? -1 : 1;

  const saveSlot = (draft: SlotDraft, replacing: SlotDraft | null) => {
    const rest = slots.filter(
      (s) =>
        !(replacing && s.date === replacing.date && s.time === replacing.time),
    );
    // The same evening twice would split the vote between two identical rows,
    // so a duplicate collapses onto the existing one rather than being added.
    if (rest.some((s) => s.date === draft.date && s.time === draft.time)) {
      setSlots(rest.sort(byTime));
      return;
    }
    setSlots([...rest, draft].sort(byTime));
  };

  const removeSlot = (slot: SlotDraft) =>
    setSlots(slots.filter((s) => s.date !== slot.date || s.time !== slot.time));

  const pickImage = async () => {
    const picked = await pickCoverImage();
    if (picked) setImageKey(picked);
  };
  /**
   * The fields somebody has set by hand, which the parser then leaves alone.
   *
   * A time arriving from the catch-up finder counts as set by hand: it was
   * chosen on the previous screen, and a stray word in the title must not move
   * it.
   */
  const [edited, setEdited] = useState<Partial<Record<Field, boolean>>>(
    on || at ? { date: true, time: true } : {},
  );
  const setTouched = (field: Field) =>
    setEdited((current) => ({ ...current, [field]: true }));

  /**
   * The parse runs on every keystroke and fills only the fields nobody has set
   * by hand, so correcting one thing never has it overwritten by the next
   * character typed.
   *
   * Which fields those are is tracked one at a time. A single flag for the
   * whole form looked equivalent and was not: touching ANY control, the When
   * buttons included, stopped the parse dead, so the name never came out of the
   * sentence again. Since the sentence is the only place a name is typed and an
   * empty name is what greys out the button, picking Poll first and then typing
   * left a filled-in form that refused to save and would not say why.
   */
  const onRawChange = (next: string) => {
    setRaw(next);

    const parsed = parseEventText(next, tz);
    // The name always follows the sentence unless it has been edited on its
    // own: there is nowhere else to type one.
    if (!edited.title) setTitle(parsed.title);
    if (parsed.date && !edited.date) setDate(parsed.date);
    if (parsed.time && !edited.time) setTime(parsed.time);
    if (parsed.location && !edited.location) setLocation(parsed.location);

    // Only when the text SAYS something about timing. "all day" and "TBC" are
    // how people write it, and both are states the control already has, so
    // typing them should move it rather than leaving the words stranded in the
    // title. A null means nothing was said, which must not overwrite a choice
    // made by hand.
    //
    // "TBC" lands on Ask, which is the same state with something to do about
    // it: writing that the time is to be confirmed and then confirming it with
    // nobody is how an event stays undated for a fortnight.
    if (parsed.precision && !edited.precision) setPrecision(parsed.precision);
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

  /**
   * What the sentence yielded, as chips.
   *
   * Each one is tappable to overrule the parse, which is the whole reason they
   * exist: a guess you cannot correct is worse than no guess. The name is a chip
   * too, so the single input stays the way you write an event and there is
   * still a way to fix a title the parser trimmed too far.
   */
  const chips: Chip[] = [
    ...(title.trim()
      ? [
          {
            key: "name",
            label: title.trim(),
            icon: "text-outline" as const,
            onPress: () => setEditingName(true),
          },
        ]
      : []),
    ...(precision === "tbc"
      ? []
      : [
          {
            key: "date",
            label: prettyDate(date),
            icon: "calendar-outline" as const,
            onPress: () => setPickingWhen(true),
          },
        ]),
    ...(precision === "datetime" && time
      ? [
          {
            key: "time",
            label: time,
            icon: "time-outline" as const,
            onPress: () => setPickingWhen(true),
          },
        ]
      : []),
    ...(location.trim()
      ? [
          {
            key: "place",
            label: location.trim(),
            icon: "location-outline" as const,
            onPress: () => setPickingPlace(true),
            onClear: () => setLocation(""),
          },
        ]
      : []),
  ];

  const submit = () => {
    const effectiveTime = precision === "datetime" ? (time ?? "19:00") : "12:00";
    // An end before the start means they meant the small hours: a gig ending at
    // 01:00 is the next day, not a negative event.
    const endWall =
      precision === "datetime" && endTime
        ? `${endTime < effectiveTime ? nextDay(date) : date}T${endTime}:00`
        : null;

    const eventId = createEvent(calendarId, {
      title,
      startUtc: zonedWallToUtc(`${date}T${effectiveTime}:00`, tz),
      endUtc: endWall ? zonedWallToUtc(endWall, tz) : null,
      tz,
      localWall: `${date}T${effectiveTime}:00`,
      precision,
      locationName: location || null,
      ticketsRequired,
      ticketUrl: ticketsRequired ? ticketUrl : null,
      imageKey,
    });

    // Asked from a person's page: the event is theirs to accept, and it lands
    // in their own calendar when they do.
    if (invite) sendEventInvite(eventId, invite);

    if (precision === "tbc") {
      startPoll(eventId, openSuggestions ? "open" : "proposed");
      // Only times the organiser actually chose. Nothing is seeded from the
      // form's own date: that would put a candidate on the poll nobody picked.
      for (const slot of slots) {
        const wall = `${slot.date}T${slot.time}:00`;
        proposeSlot(eventId, {
          startUtc: zonedWallToUtc(wall, tz),
          tz,
          localWall: wall,
          precision: "datetime",
        });
      }
    }

    router.back();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: invite && withName ? `Invite ${withName}` : "Add an event",
          presentation: "modal",
        }}
      />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {invite ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Ionicons name="paper-plane-outline" size={18} color={t.color.accent} />
            <Text style={{ ...type.caption, flex: 1, color: t.color.text }}>
              This goes in your own plans and is sent to {withName ?? "them"} to
              say yes or no to. If they say yes it lands in theirs too.
            </Text>
          </Card>
        ) : null}

        {/* One field, not two. The name used to have its own box under this
            one, holding the same value the parser had just extracted, so there
            were two places to type a name and no way to tell which counted.
            What the sentence yielded is reported as chips instead: smaller than
            a parallel form, and every one of them is a way to overrule it. */}
        <Group>
          <TextField
            bare
            value={raw}
            onChange={onRawChange}
            placeholder="Dinner at Time Out Market Friday 8pm"
            autoFocus
          />

          {chips.length > 0 ? <Chips chips={chips} /> : null}

          {editingName ? (
            <TextField
              bare
              value={title}
              onChange={(v) => {
                setTouched("title");
                setTitle(v);
              }}
              onBlur={() => setEditingName(false)}
              placeholder="Event name"
              autoFocus
              maxLength={80}
            />
          ) : null}
        </Group>

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

        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>When</Text>

          {/* One track, two rows. Who may suggest is not a new question: it
              only exists because Poll was chosen, so it sits inside the same
              control as a sub-row rather than beneath it as an equal. */}
          <SegmentedGroup>
            <Segmented<When>
              bare
              value={precision === "tbc" ? "ask" : precision}
              onChange={(next) => {
                setTouched("precision");
                setPrecision(next === "ask" ? "tbc" : next);
              }}
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

          {precision === "tbc" ? (
            <>
              <Muted>
                {openSuggestions
                  ? "Anyone can put times forward as well as answer yours."
                  : "Only you put times up. People answer the ones you add."}
              </Muted>

              {slots.length > 0 ? (
                <Group>
                  {slots.map((slot) => (
                    <View
                      key={`${slot.date}T${slot.time}`}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.md,
                      }}
                    >
                      <Text style={{ ...type.body, flex: 1, color: t.color.text }}>
                        {prettyDate(slot.date)} · {slot.time}
                      </Text>
                      <Pressable
                        onPress={() => setEditing(slot)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`Change or remove ${prettyDate(slot.date)} at ${slot.time}`}
                      >
                        <Ionicons name="pencil" size={15} color={t.color.textMuted} />
                      </Pressable>
                    </View>
                  ))}
                </Group>
              ) : null}

              <Pressable
                onPress={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
                accessibilityRole="button"
              >
                <Text style={{ ...type.label, color: t.color.accent }}>
                  Add an option
                </Text>
              </Pressable>

              <SlotDialog
                visible={dialogOpen || editing !== null}
                initial={editing}
                tz={tz}
                rangeStart={calendar?.start_date ?? null}
                rangeEnd={calendar?.end_date ?? null}
                onSave={(draft) => saveSlot(draft, editing)}
                onRemove={editing ? () => removeSlot(editing) : undefined}
                onClose={() => {
                  setDialogOpen(false);
                  setEditing(null);
                }}
              />
            </>
          ) : (
            <>
              {/* Both rows open the SAME dialog the chips do. They used to
                  drive an inline picker instead, so tapping a chip unfolded a
                  calendar further down the form with no way to dismiss it, and
                  the screen showed two ways to set one date at once.

                  The finish lives in that dialog too rather than on a row of
                  its own: start and end are one decision, and shown here as a
                  single "19:00 to 21:00" the form stays two lines whether or
                  not an event has an end. */}
              <Group>
                <RowButton
                  bare
                  label="Date"
                  value={prettyDate(date)}
                  onPress={() => setPickingWhen(true)}
                />
                {precision === "datetime" ? (
                  <RowButton
                    bare
                    label="Time"
                    value={
                      time
                        ? endTime
                          ? `${time} to ${endTime}${endTime < time ? " next day" : ""}`
                          : time
                        : "Pick a time"
                    }
                    onPress={() => setPickingWhen(true)}
                  />
                ) : null}
              </Group>
              <Muted>Times are in the calendar's zone, {tz}.</Muted>
            </>
          )}
        </View>

        <SlotDialog
          visible={pickingWhen}
          initial={{ date, time: time ?? "19:00", endTime }}
          tz={tz}
          rangeStart={calendar?.start_date ?? null}
          rangeEnd={calendar?.end_date ?? null}
          title="When is it?"
          saveLabel="Set time"
          dateLabel="On"
          timeLabel="Starts"
          withTime={precision === "datetime"}
          withEnd={precision === "datetime"}
          onSave={(draft) => {
            setTouched("date");
            setDate(draft.date);
            if (precision === "datetime") {
              setTime(draft.time);
              setEndTime(draft.endTime ?? null);
            }
          }}
          onClose={() => setPickingWhen(false)}
        />

        {/* Where earns a section of its own: it is the second thing anyone
            asks after when, and it was previously a nameless first row above a
            tickets toggle. */}
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>Where</Text>
          <Group>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              {/* The bare field has no flex of its own — the Group normally
                  gives it the full row — so sharing a row with the map button
                  needs this wrapper, or the field collapses to nothing and the
                  value it holds becomes invisible. */}
              <View style={{ flex: 1 }}>
                <TextField
                  bare
                  value={location}
                  onChange={(v) => {
                    setTouched("location");
                    setLocation(v);
                  }}
                  placeholder="Somewhere, or leave it blank"
                  maxLength={80}
                />
              </View>
              <Pressable
                onPress={() => setPickingPlace(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Find a place"
              >
                <Ionicons name="map-outline" size={19} color={t.color.accent} />
              </Pressable>
            </View>
          </Group>
        </View>

        <PlaceDialog
          visible={pickingPlace}
          value={location}
          onSelect={(place) => {
            setTouched("location");
            setLocation(place);
          }}
          onClose={() => setPickingPlace(false)}
        />

        {/* Tickets and the photo: the practicalities, once when and where are
            settled. */}
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.textMuted }}>Details</Text>
          <Group>
            <ToggleRow
              bare
              label="Tickets needed"
              value={ticketsRequired}
              onChange={setTicketsRequired}
            />
            {ticketsRequired ? (
              <TextField
                bare
                value={ticketUrl}
                onChange={setTicketUrl}
                placeholder="Link to tickets"
                autoCapitalize="none"
              />
            ) : null}

            {/* A photo is optional decoration, so it is a row until it exists
                rather than a grey slab competing with the fields that matter.
                It is only ever seen on the event's own screen: a list of
                photographs is a feed, and a day's plans read faster as text. */}
            <Pressable
              onPress={() => void pickImage()}
              accessibilityRole="button"
              accessibilityLabel={imageKey ? "Change the photo" : "Add a photo"}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ ...type.body, color: t.color.textMuted }}>
                {imageKey ? "Photo" : "Add a photo"}
              </Text>
              <Ionicons
                name={imageKey ? "pencil" : "image-outline"}
                size={17}
                color={t.color.textMuted}
              />
            </Pressable>

            {imageKey ? (
              <View style={{ gap: space.sm }}>
                <Cover value={imageKey} height={110} />
                <Pressable
                  onPress={() => setImageKey(null)}
                  accessibilityRole="button"
                >
                  <Text style={{ ...type.caption, color: t.color.textMuted }}>
                    Remove photo
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </Group>
        </View>

        {/* A greyed-out button that will not say what it is waiting for is a
            dead end, and this one waits on a field that is easy to miss:
            the name comes out of the sentence at the top, so an empty name
            looks like a form with nothing wrong with it. */}
        {valid ? null : (
          <Text
            style={{
              ...type.caption,
              color: t.color.textMuted,
              textAlign: "center",
            }}
          >
            Give it a name first, in the box at the top.
          </Text>
        )}
        <PrimaryButton
          label={invite ? `Send to ${withName ?? "them"}` : "Add to calendar"}
          onPress={submit}
          disabled={!valid}
        />
      </ScrollView>
    </>
  );
}
