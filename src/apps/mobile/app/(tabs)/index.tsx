import { useFocusEffect, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import {
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { PULL, overscrollPast, pullEdge, releaseAction, topRelease } from "@calder/core";
import type { PullEdge } from "@calder/core";

import { AddEventButton } from "@/components/AddEventButton";
import { DayTimeline } from "@/components/DayTimeline";
import { EventRow } from "@/components/EventRow";
import { Segmented } from "@/components/form";
import { EmptyState, SyncBanner } from "@/components/ui";
import type { DayRsvpCounts } from "@/db/repo";
import {
  getBoolPref,
  listAgenda,
  listAgendaBetween,
  listMembers,
  listRsvpsForCalendar,
  pendingMutationCount,
  rsvpCountsByDay,
} from "@/db/repo";
import { syncNow } from "@/db/sync";
import {
  listMembersForCalendars,
  listRsvpsForCalendars,
} from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import {
  formatCountdown,
  formatDayHeading,
  formatDayShort,
  formatEventTime,
} from "@/lib/format";
import { radius, space, type, useTheme } from "@/theme";

type View3 = "list" | "week" | "month";

type AgendaEvent = ReturnType<typeof listAgenda>[number];

/**
 * unlockAsync, NOT lockAsync(ALL): "all" includes upside-down, which an iPhone
 * does not support, and asking for it throws rather than settling for what the
 * device can do. Every call is caught, because a refused orientation request
 * must never surface as an unhandled rejection, and failing to rotate is not a
 * reason to take a screen down.
 */
function applyOrientation(view: View3): void {
  void (view === "month"
    ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    : ScreenOrientation.unlockAsync()
  ).catch(() => {});
}

/**
 * Home. Everything I am doing across every calendar (access pattern 13).
 *
 * Three ways to read the same data, because "what's next" and "how busy is this
 * month" are different questions: a list for the next thing, a week of columns
 * for comparing days side by side, a month grid for shape and density.
 *
 * It falls through to Calendars when empty, because an empty home screen for a
 * new user is how apps die in week one (§3.5).
 */
export default function AgendaScreen() {
  const router = useRouter();
  const [view, setView] = useState<View3>("list");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));

  const pending = useQuery("pending", () => pendingMutationCount());
  const anyEvents = useQuery("agenda-count", () => listAgenda(1).length);

  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  /**
   * Rotation is allowed for Agenda and Week, and locked out of Month.
   *
   * Turning the phone should reveal detail, and the month grid has none left to
   * reveal: a wide version of it is the same information with more whitespace.
   *
   * Applied WITHOUT a cleanup on the view change. A cleanup here re-locked
   * portrait on every switch between Agenda and Week, so the device snapped
   * upright and then back again — the flash of portrait you saw mid-switch. The
   * only moment portrait must be restored is when the tab loses focus, which is
   * what the focus effect below is for.
   */
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    applyOrientation(view);
  }, [view]);

  /**
   * Leaving the tab hands the phone back to everyone else upright, since the
   * other tabs are portrait-only screens. The callback is deliberately stable:
   * if it depended on `view` it would re-run on every switch and reintroduce
   * exactly the flash described above.
   */
  useFocusEffect(
    useCallback(() => {
      applyOrientation(viewRef.current);
      return () => {
        void ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.PORTRAIT_UP,
        ).catch(() => {});
      };
    }, []),
  );

  if (anyEvents === 0) {
    return (
      <EmptyState
        title="Nothing coming up"
        body="Your agenda fills in as friends add events to calendars you're part of."
        actionLabel="Go to calendars"
        onAction={() => router.push("/calendars")}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner pending={pending} />
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
        <Segmented
          value={view}
          options={[
            { value: "list", label: "Agenda" },
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
          onChange={(next) => {
            setAnchor(startOfDay(new Date()));
            setView(next);
          }}
        />
      </View>

      {view === "list" ? <ListView landscape={landscape} /> : null}
      {view === "week" ? (
        <WeekView anchor={anchor} onAnchor={setAnchor} landscape={landscape} />
      ) : null}
      {view === "month" ? (
        <MonthView anchor={anchor} onAnchor={setAnchor} />
      ) : null}

      {/* On a calendar screen the destination is implied; here it is not, so the
          button asks which calendar before opening the form. */}
      <AddEventButton />
    </View>
  );
}

/**
 * Pull to refresh.
 *
 * The gesture people already know for "get me the latest", pointed at the sync
 * entry point rather than at a re-read: local SQLite is never stale against
 * itself, so a refresh that only re-queried would be theatre.
 */
function useRefresh() {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    void syncNow().finally(() => setRefreshing(false));
  };

  return { refreshing, onRefresh };
}

// --- list ------------------------------------------------------------------

function ListView({ landscape }: { landscape: boolean }) {
  const t = useTheme();
  const events = useQuery("agenda", () => listAgenda());
  const countdown = useQuery("pref:countdown", () =>
    getBoolPref("countdown", true),
  );

  const groups = new Map<string, typeof events>();
  for (const e of events) {
    const key = e.start_utc.slice(0, 10);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const { refreshing, onRefresh } = useRefresh();

  // Sideways: the days sit next to each other instead of under each other, so a
  // week of plans can be compared rather than scrolled through.
  if (landscape) return <DayColumns groups={groups} />;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {[...groups.entries()].map(([dayIso, dayEvents]) => {
        const until = countdown ? formatCountdown(dayIso) : null;
        return (
          <View key={dayIso} style={{ gap: space.sm }}>
            {/* Heading and countdown share a row: the countdown is a property of
                the date, not a separate line competing with it. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                gap: space.md,
              }}
            >
              <Text
                style={{
                  ...type.label,
                  color: t.color.textMuted,
                  flexShrink: 1,
                }}
                numberOfLines={1}
              >
                {formatDayHeading(`${dayIso}T12:00:00.000Z`, "UTC")}
              </Text>
              {until ? (
                <Text
                  style={{
                    ...type.label,
                    marginLeft: "auto",
                    color: until === "Today" ? t.color.accent : t.color.textMuted,
                  }}
                >
                  {until}
                </Text>
              ) : null}
            </View>
            {dayEvents.map((e) => (
              <AgendaItem key={e.event_id} event={e} />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function AgendaItem({
  event,
}: {
  event: ReturnType<typeof listAgenda>[number];
}) {
  const members = useQuery(`members:${event.calendar_id}`, () =>
    listMembers(event.calendar_id),
  );
  const rsvps = useQuery(`rsvps:${event.calendar_id}`, () =>
    listRsvpsForCalendar(event.calendar_id),
  );

  return (
    <EventRow
      event={event}
      members={members}
      rsvps={rsvps}
      subtitle={event.calendar_name}
    />
  );
}

// --- week ------------------------------------------------------------------

/**
 * Seven days from today, all visible at once and one selected at a time.
 *
 * It is a rolling week, not a calendar week: the question this view answers is
 * "what does the next seven days look like", and a Monday-first grid answers
 * that badly on a Saturday by spending five columns on days already gone.
 *
 * The whole week lives in the strip so you can compare days without scrolling,
 * and the chosen day gets the full width below it, so events keep their RSVP
 * controls instead of shrinking into unreadable cards.
 */
function WeekView({
  anchor,
  onAnchor,
  landscape,
}: {
  anchor: Date;
  onAnchor: (next: Date) => void;
  landscape: boolean;
}) {
  const t = useTheme();

  const start = anchor;
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const from = days[0]!;
  const to = addDays(start, 7);

  const [selected, setSelected] = useState<string | null>(null);
  const chosenKey = selected ?? iso(from);

  const events = useQuery(`week:${iso(from)}`, () =>
    listAgendaBetween(from.toISOString(), to.toISOString()),
  );
  const counts = useQuery(`week-dots:${iso(from)}`, () =>
    rsvpCountsByDay(from.toISOString(), to.toISOString()),
  );

  const todayIso = iso(startOfDay(new Date()));
  const chosen = events.filter((e) => e.start_utc.slice(0, 10) === chosenKey);
  const chosenDay = new Date(`${chosenKey}T00:00:00.000Z`);

  const scroller = useRef<ScrollView>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [edge, setEdge] = useState<PullEdge>(null);
  const edgeRef = useRef<PullEdge>(null);

  // The deepest this drag has reached in each direction. The decision is made on
  // RELEASE, so a hint can promise "Release for Sat 5" and then keep it; firing
  // mid-drag means finding out what you did after it has happened.
  const depth = useRef({ up: 0, down: 0 });

  // Landing on a new day part-way down the previous one would look like a
  // rendering fault, so every change of day starts at the top.
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
    reset();
  }, [chosenKey]);

  function reset() {
    depth.current = { up: 0, down: 0 };
    if (edgeRef.current !== null) {
      edgeRef.current = null;
      setEdge(null);
    }
  }

  const goToDay = (day: Date) => {
    const key = iso(day);
    // Past the end of the window the week itself moves, so the strip keeps the
    // chosen day on it rather than selecting something invisible.
    if (key >= iso(to)) onAnchor(addDays(anchor, 7));
    else if (key < iso(from)) onAnchor(addDays(anchor, -7));
    setSelected(key);
  };

  // The pan responders are created once, so they cannot close over this render's
  // goToDay. A ref keeps them pointed at the current one.
  const step = useRef((_days: number) => {});
  step.current = (days: number) => goToDay(addDays(chosenDay, days));

  const week = useRef((_weeks: number) => {});
  week.current = (weeks: number) => {
    setSelected(null);
    onAnchor(addDays(anchor, weeks * 7));
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const metrics = {
      offsetY: contentOffset.y,
      layoutHeight: layoutMeasurement.height,
      contentHeight: contentSize.height,
    };

    depth.current = {
      up: Math.max(depth.current.up, -metrics.offsetY),
      down: Math.max(depth.current.down, overscrollPast(metrics)),
    };

    // The hints are an answer to a gesture already under way, so they show only
    // while the pull is near an edge and go again the moment it is not.
    const next = pullEdge(metrics);
    if (next !== edgeRef.current) {
      edgeRef.current = next;
      setEdge(next);
    }
  };

  /** Let go: whichever end was reached far enough decides. */
  const onRelease = () => {
    const action = releaseAction(depth.current);
    reset();
    if (action === "next-day") step.current(1);
    else if (action === "previous-day") step.current(-1);
  };

  /**
   * The system refresh control fired, which means a downward pull was released.
   * Refresh and "a day back" share that direction, so only the distance
   * separates them.
   */
  const onRefresh = () => {
    const action = topRelease(depth.current.up);
    reset();

    if (action === "previous-day") {
      setRefreshing(false);
      step.current(-1);
      return;
    }

    setRefreshing(true);
    void syncNow().finally(() => setRefreshing(false));
  };

  /**
   * Sideways on the CONTENT moves a day; sideways on the STRIP moves a week.
   * The strip is the week, so dragging it should move weeks, which also gives
   * the Back and Next buttons a gesture equivalent.
   *
   * Both only claim the gesture once it is clearly horizontal, so the list
   * underneath still scrolls: a finger that has travelled twice as far across as
   * down, and at least 24pt, is a swipe rather than a scroll.
   */
  const horizontal = (onSwipe: (direction: number) => void) =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -40) onSwipe(1);
        else if (g.dx > 40) onSwipe(-1);
      },
    });

  const daySwipe = useRef(horizontal((d) => step.current(d))).current;
  const weekSwipe = useRef(horizontal((d) => week.current(d))).current;

  // Sideways: the hour grid for the chosen day, where a 19:00 and a 19:30 stop
  // being two lines and start being two blocks that visibly clash.
  if (landscape) {
    return (
      <LandscapeDay
        dayIso={chosenKey}
        events={chosen}
        onPrev={() => step.current(-1)}
        onNext={() => step.current(1)}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stepper
        label={`${short(from)} to ${short(addDays(start, 6))}`}
        onBack={() => {
          setSelected(null);
          onAnchor(addDays(anchor, -7));
        }}
        onNext={() => {
          setSelected(null);
          onAnchor(addDays(anchor, 7));
        }}
      />

      {/* All seven fit across the screen, so the week is a glance rather than a
          scroll. Dots carry the detail the narrow pill cannot. */}
      <View
        {...weekSwipe.panHandlers}
        style={{
          flexDirection: "row",
          gap: 4,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
        }}
      >
        {days.map((day) => {
          const key = iso(day);
          const isSelected = key === chosenKey;
          const isToday = key === todayIso;

          return (
            <Pressable
              key={key}
              onPress={() => setSelected(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={{
                flex: 1,
                paddingVertical: space.sm,
                alignItems: "center",
                gap: 3,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: isSelected ? t.color.accent : t.color.border,
                backgroundColor: isSelected ? t.color.accent : t.color.surface,
              }}
            >
              <Text
                style={{
                  ...type.caption,
                  fontSize: 11,
                  color: isSelected ? "#fff" : t.color.textMuted,
                }}
              >
                {isToday
                  ? "Today"
                  : day.toLocaleDateString("en-GB", {
                      weekday: "short",
                      timeZone: "UTC",
                    })}
              </Text>
              <Text
                style={{
                  ...type.label,
                  fontSize: 17,
                  color: isSelected ? "#fff" : t.color.text,
                }}
              >
                {day.getUTCDate()}
              </Text>
              <DayDots counts={counts[key]} onAccent={isSelected} />
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }} {...daySwipe.panHandlers}>
      <ScrollView
        ref={scroller}
        onScroll={onScroll}
        onScrollEndDrag={onRelease}
        scrollEventThrottle={16}
        alwaysBounceVertical
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        // flexGrow fills the frame on a day with nothing on it, so the pull to
        // the next day is available there too rather than only on busy days.
        contentContainerStyle={{
          padding: space.lg,
          gap: space.sm,
          paddingBottom: 96,
          flexGrow: 1,
        }}
      >
        <Text style={{ ...type.label, color: t.color.textMuted }}>
          {formatDayHeading(`${chosenKey}T12:00:00.000Z`, "UTC")}
        </Text>
        {chosen.length === 0 ? (
          <Text style={{ ...type.body, color: t.color.textMuted }}>
            Nothing on this day.
          </Text>
        ) : (
          chosen.map((e) => <AgendaItem key={e.event_id} event={e} />)
        )}
      </ScrollView>

        {/* Overlaid rather than placed in the content, so appearing mid-gesture
            cannot shift the list under the finger. A night out that runs to
            02:00 belongs to the next day as far as the database is concerned
            and to tonight as far as anyone living it is concerned: pulling past
            the end is the cheapest way to cross that line. */}
        <EdgeHint visible={edge === "top"} top>
          Release to refresh, keep pulling for{" "}
          {short(addDays(chosenDay, -1))}
        </EdgeHint>
        <EdgeHint visible={edge === "top-day"} top>
          Release for {short(addDays(chosenDay, -1))}
        </EdgeHint>
        <EdgeHint visible={edge === "bottom"}>
          Keep pulling for {short(addDays(chosenDay, 1))}
        </EdgeHint>
        <EdgeHint visible={edge === "bottom-day"}>
          Release for {short(addDays(chosenDay, 1))}
        </EdgeHint>
      </View>
    </View>
  );
}

/**
 * The RSVP shape of one day, at a glance.
 *
 * One dot per event, coloured by my answer, grouped so the eye reads "two
 * confirmed, one unanswered" without counting. Past the point where dots stop
 * being countable the day becomes a number instead, which is exact and takes
 * one slot however busy the day is.
 */

/** Thresholds and the release decision live in @calder/core, where they are
 * tested: see gestures.ts and test/gestures.test.mjs. */

function EdgeHint({
  visible,
  top,
  children,
}: {
  visible: boolean;
  top?: boolean;
  children: ReactNode;
}) {
  const t = useTheme();
  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        ...(top ? { top: space.sm } : { bottom: space.sm }),
        alignItems: "center",
      }}
    >
      <Text
        style={{
          ...type.caption,
          overflow: "hidden",
          color: t.color.textMuted,
          backgroundColor: t.color.surfaceAlt,
          paddingHorizontal: space.md,
          paddingVertical: 4,
          borderRadius: radius.pill,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

/**
 * A cancelled event: a warm amber disc with a white cross through it.
 *
 * Two thin bars rotated into an X rather than a glyph, because at 7pt an icon
 * font renders as a smudge and this stays crisp at any density.
 */
/**
 * One category's count, inside a disc of that category's colour.
 *
 * The disc is what ties the collapsed form back to the dots it replaces: the
 * same coloured circle, with a number in it rather than repeated. Bare coloured
 * digits read as text and lose that link, and at 9pt a red digit beside an amber
 * one is much harder to tell apart than two filled circles are.
 *
 * It grows into a pill for a two-digit count rather than shrinking the text,
 * because 6pt numerals are not legible on any screen.
 */
function Tally({
  colour,
  count,
  emphasis,
  crossed,
}: {
  colour: string;
  count: number;
  /** The bottom row: things still wanting something from me. */
  emphasis?: boolean;
  /** Cancelled, marked so it does not read as a third shade of amber. */
  crossed?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
      {crossed ? <CancelledDot /> : null}
      <View
        style={{
          minWidth: COUNT_CIRCLE,
          height: COUNT_CIRCLE,
          paddingHorizontal: 2,
          borderRadius: radius.pill,
          backgroundColor: colour,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            fontSize: 9,
            lineHeight: 11,
            fontWeight: emphasis ? "800" : "700",
            color: "#fff",
          }}
        >
          {count}
        </Text>
      </View>
    </View>
  );
}

function CancelledDot() {
  return (
    <View
      style={{
        width: DOT,
        height: DOT,
        borderRadius: DOT / 2,
        backgroundColor: CANCELLED_AMBER,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {[45, -45].map((deg) => (
        <View
          key={deg}
          style={{
            position: "absolute",
            width: 5,
            height: 1.2,
            borderRadius: 1,
            backgroundColor: "#fff",
            transform: [{ rotate: `${deg}deg` }],
          }}
        />
      ))}
    </View>
  );
}

/** Warm and non-alarming: cancelled is a fact, not an error. */
const CANCELLED_AMBER = "#D08A3E";

/**
 * Every mark in the strip is one of two sizes, and only two: a dot, or a circle
 * with a count in it. Emphasis on the bottom row comes from weight and the
 * divider above it, not from growing the shapes — a strip where the same thing
 * is drawn at four sizes reads as inconsistent rather than as a hierarchy.
 */
const DOT = 7;
const COUNT_CIRCLE = 13;

function DayDots({
  counts,
  onAccent,
  maxMarks = 5,
}: {
  counts: DayRsvpCounts | undefined;
  onAccent: boolean;
  /**
   * How many marks a row fits before it collapses to counts. A month cell is
   * narrower than a week pill, so it collapses sooner rather than wrapping and
   * stretching the grid.
   */
  maxMarks?: number;
}) {
  const t = useTheme();
  if (!counts) return <View style={{ height: 7 }} />;

  // On the selected pill the background is the accent colour, where a red dot
  // and an amber dot both read as "dark smudge". White marks keep the count
  // legible; the colours are still there on the other six days.
  const answered: Mark[] = [
    { key: "going", count: counts.going, colour: onAccent ? "#fff" : t.color.going, label: "going" },
    { key: "maybe", count: counts.maybe, colour: onAccent ? "#fff" : t.color.maybe, label: "maybe" },
    {
      key: "not_going",
      count: counts.not_going,
      colour: onAccent ? "#fff" : t.color.notGoing,
      label: "not going",
    },
  ].filter((m) => m.count > 0);

  const open: Mark[] = [
    {
      key: "none",
      count: counts.none,
      colour: onAccent ? "#fff" : t.color.textMuted,
      label: "not answered",
    },
    {
      key: "cancelled",
      count: counts.cancelled,
      colour: CANCELLED_AMBER,
      label: "cancelled",
      crossed: true,
    },
  ].filter((m) => m.count > 0);

  if (answered.length === 0 && open.length === 0) {
    return <View style={{ height: 7 }} />;
  }

  const described = [...answered, ...open]
    .map((m) => `${m.count} ${m.label}`)
    .join(", ");

  /**
   * Two rows, divided: answered above, still open below.
   *
   * That split is the point of the whole strip. "Six things on" is ambient;
   * "two of them are waiting on you" is worth crossing a room for, so it gets
   * its own line and a heavier weight rather than sitting fourth in a row of
   * equals. The divider only appears when there is something under it, so a day
   * you have dealt with stays a single quiet row.
   */
  return (
    <View
      accessibilityLabel={described}
      style={{ alignItems: "center", gap: 3, alignSelf: "stretch" }}
    >
      {answered.length > 0 ? (
        <MarkRow marks={answered} maxMarks={maxMarks} />
      ) : null}

      {open.length > 0 ? (
        <>
          {answered.length > 0 ? (
            // A full point, not a hairline: at 0.33pt in the border colour
            // this read as a rendering artefact rather than a divider. Its
            // width is fixed to the marks rather than the cell, so it separates
            // the two rows instead of looking like a cell edge.
            <View
              style={{
                height: 1,
                width: 22,
                borderRadius: 1,
                backgroundColor: onAccent
                  ? "rgba(255,255,255,0.7)"
                  : t.color.textMuted,
                opacity: onAccent ? 1 : 0.45,
              }}
            />
          ) : null}
          <MarkRow marks={open} maxMarks={maxMarks} emphasis />
        </>
      ) : null}
    </View>
  );
}

interface Mark {
  key: string;
  count: number;
  colour: string;
  label: string;
  crossed?: boolean;
}

/**
 * One row of the strip: a dot per event while they are still countable, and a
 * count per category once they are not. The decision is per ROW, so a day with
 * five settled things and one unanswered one still shows that single one as a
 * dot rather than dragging it into numbers with the rest.
 */
function MarkRow({
  marks,
  maxMarks,
  emphasis,
}: {
  marks: readonly Mark[];
  maxMarks: number;
  emphasis?: boolean;
}) {
  const total = marks.reduce((sum, m) => sum + m.count, 0);

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        minHeight: DOT,
      }}
    >
      {marks.map((m) =>
        total > maxMarks ? (
          <Tally
            key={m.key}
            colour={m.colour}
            count={m.count}
            emphasis={emphasis}
            crossed={m.crossed}
          />
        ) : (
          [...Array(m.count)].map((_, i) =>
            m.crossed ? (
              <CancelledDot key={`${m.key}-${i}`} />
            ) : (
              <View
                key={`${m.key}-${i}`}
                style={{
                  width: DOT,
                  height: DOT,
                  borderRadius: DOT / 2,
                  backgroundColor: m.colour,
                }}
              />
            ),
          )
        ),
      )}
    </View>
  );
}

/**
 * The agenda, turned sideways: one column per day.
 *
 * Portrait stacks days, which answers "what is next". Landscape puts them side
 * by side, which answers "which day is free" — the question you turn a phone to
 * ask. Columns are fixed-width and scroll, because a column narrow enough to fit
 * a whole week cannot hold a legible title.
 */
function DayColumns({ groups }: { groups: Map<string, AgendaEvent[]> }) {
  const t = useTheme();
  const router = useRouter();
  const days = [...groups.entries()];

  return (
    <ScrollView
      horizontal
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
    >
      {days.map(([dayIso, dayEvents]) => (
        <View key={dayIso} style={{ width: 200, gap: space.sm }}>
          <Text style={{ ...type.label, color: t.color.text }}>
            {formatDayShort(dayIso, "UTC")}
          </Text>
          <ScrollView contentContainerStyle={{ gap: space.sm, paddingBottom: space.xl }}>
            {dayEvents.map((e) => (
              <Pressable
                key={e.event_id}
                onPress={() =>
                  router.push({
                    pathname: "/calendar/[calendarId]/event/[eventId]",
                    params: { calendarId: e.calendar_id, eventId: e.event_id },
                  })
                }
                style={{
                  padding: space.md,
                  gap: 2,
                  borderRadius: radius.sm,
                  borderWidth: 1,
                  borderColor: t.color.border,
                  backgroundColor: t.color.surface,
                }}
              >
                <Text style={{ ...type.caption, color: t.color.textMuted }}>
                  {formatEventTime({
                    startUtc: e.start_utc,
                    endUtc: e.end_utc ?? undefined,
                    tz: e.tz,
                    localWall: e.local_wall,
                    precision: e.precision,
                  })}
                </Text>
                <Text
                  numberOfLines={2}
                  style={{
                    ...type.body,
                    color: t.color.text,
                    textDecorationLine:
                      e.status === "cancelled" ? "line-through" : "none",
                  }}
                >
                  {e.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ ...type.caption, color: t.color.textMuted }}
                >
                  {e.calendar_name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * One day as an hour grid, reusing the calendar day screen's timeline so the two
 * places that draw a day cannot drift apart.
 *
 * Members and RSVPs come from every calendar the day touches, since an agenda
 * day is not one calendar's day.
 */
function LandscapeDay({
  dayIso,
  events,
  onPrev,
  onNext,
}: {
  dayIso: string;
  events: readonly AgendaEvent[];
  onPrev: () => void;
  onNext: () => void;
}) {
  const t = useTheme();
  const calendarIds = [...new Set(events.map((e) => e.calendar_id))].sort();
  const key = calendarIds.join(",");

  /**
   * The hour grid needs ONE zone, and an agenda day can hold events from
   * calendars in several. The commonest zone among the day's events wins, since
   * that is the one most of the blocks would otherwise be drawn wrong in;
   * failing that, the phone's own. A day that genuinely straddles two zones will
   * misplace the minority by the offset, which is the honest limit of drawing
   * one axis. Each event still shows its own time in its own zone.
   */
  const tz = dominantZone(events);

  const members = useQuery(`members-for:${key}`, () =>
    listMembersForCalendars(calendarIds),
  );
  const rsvps = useQuery(`rsvps-for:${key}`, () =>
    listRsvpsForCalendars(calendarIds),
  );

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: space.lg,
          paddingVertical: space.xs,
        }}
      >
        <Pressable onPress={onPrev} hitSlop={12} accessibilityLabel="Previous day">
          <Text style={{ ...type.body, color: t.color.accent }}>‹</Text>
        </Pressable>
        <Text style={{ ...type.label, color: t.color.textMuted }}>
          {formatDayHeading(`${dayIso}T12:00:00.000Z`, "UTC")}
        </Text>
        <Pressable onPress={onNext} hitSlop={12} accessibilityLabel="Next day">
          <Text style={{ ...type.body, color: t.color.accent }}>›</Text>
        </Pressable>
      </View>

      <DayTimeline
        date={dayIso}
        tz={tz}
        events={events}
        members={members}
        rsvps={rsvps}
      />
    </View>
  );
}

function dominantZone(events: readonly AgendaEvent[]): string {
  const tally = new Map<string, number>();
  for (const e of events) tally.set(e.tz, (tally.get(e.tz) ?? 0) + 1);

  let best: string | null = null;
  let bestCount = 0;
  for (const [zone, count] of tally) {
    if (count > bestCount) {
      best = zone;
      bestCount = count;
    }
  }

  return best ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

// --- month -----------------------------------------------------------------

/**
 * Density first: each cell carries a count, not titles. Tapping a day opens the
 * list underneath it, so the grid answers "when am I busy" and the list answers
 * "busy with what" without leaving the screen.
 */
function MonthView({
  anchor,
  onAnchor,
}: {
  anchor: Date;
  onAnchor: (next: Date) => void;
}) {
  const t = useTheme();
  const [selected, setSelected] = useState<string | null>(null);

  const first = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1),
  );
  const gridStart = startOfWeek(first);
  const cells = [...Array(42)].map((_, i) => addDays(gridStart, i));
  const to = addDays(gridStart, 42);

  const events = useQuery(`month:${iso(gridStart)}`, () =>
    listAgendaBetween(gridStart.toISOString(), to.toISOString()),
  );

  const counts = useQuery(`month-dots:${iso(gridStart)}`, () =>
    rsvpCountsByDay(gridStart.toISOString(), to.toISOString()),
  );

  const todayIso = iso(startOfDay(new Date()));
  const chosen = selected
    ? events.filter((e) => e.start_utc.slice(0, 10) === selected)
    : [];

  const { refreshing, onRefresh } = useRefresh();

  // Sideways moves a month, matching the week strip. Created once, so it points
  // at the current month through a ref rather than a stale closure.
  const jump = useRef((_months: number) => {});
  jump.current = (months: number) => {
    setSelected(null);
    onAnchor(
      new Date(
        Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + months, 1),
      ),
    );
  };

  const monthSwipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -40) jump.current(1);
        else if (g.dx > 40) jump.current(-1);
      },
    }),
  ).current;

  return (
    <View style={{ flex: 1 }}>
      <Stepper
        label={first.toLocaleDateString("en-GB", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })}
        onBack={() => jump.current(-1)}
        onNext={() => jump.current(1)}
      />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: 96 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={{ flexDirection: "row" }} {...monthSwipe.panHandlers}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <Text
              key={d}
              style={{
                ...type.caption,
                flex: 1,
                textAlign: "center",
                color: t.color.textMuted,
                marginBottom: space.sm,
              }}
            >
              {d}
            </Text>
          ))}
        </View>

        <View
          {...monthSwipe.panHandlers}
          style={{ flexDirection: "row", flexWrap: "wrap" }}
        >
          {cells.map((day) => {
            const key = iso(day);
            const dayCounts = counts[key];
            const count =
              (dayCounts?.going ?? 0) +
              (dayCounts?.maybe ?? 0) +
              (dayCounts?.not_going ?? 0) +
              (dayCounts?.none ?? 0);
            const outside = day.getUTCMonth() !== first.getUTCMonth();
            const isToday = key === todayIso;
            const isSelected = key === selected;

            return (
              <Pressable
                key={key}
                onPress={() => setSelected(isSelected ? null : key)}
                accessibilityLabel={`${short(day)}, ${count} events`}
                style={{
                  width: `${100 / 7}%`,
                  aspectRatio: 0.78,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  borderRadius: radius.sm,
                  backgroundColor: isSelected
                    ? t.color.accentSoft
                    : "transparent",
                }}
              >
                <Text
                  style={{
                    ...type.body,
                    color: outside
                      ? t.color.textMuted
                      : isToday
                        ? t.color.accent
                        : t.color.text,
                    fontWeight: isToday ? "700" : "400",
                    opacity: outside ? 0.5 : 1,
                  }}
                >
                  {day.getUTCDate()}
                </Text>
                {/* The same dots as the week strip: colour is the answer I
                    gave, so a month reads as "mostly sorted" or "mostly
                    unanswered" at a glance rather than just "busy". */}
                <DayDots counts={dayCounts} onAccent={false} maxMarks={3} />
              </Pressable>
            );
          })}
        </View>

        {selected ? (
          <View style={{ gap: space.sm, marginTop: space.lg }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>
              {formatDayHeading(`${selected}T12:00:00.000Z`, "UTC")}
            </Text>
            {chosen.length === 0 ? (
              <Text style={{ ...type.body, color: t.color.textMuted }}>
                Nothing on this day.
              </Text>
            ) : (
              chosen.map((e) => <AgendaItem key={e.event_id} event={e} />)
            )}
          </View>
        ) : (
          <Text
            style={{
              ...type.caption,
              color: t.color.textMuted,
              textAlign: "center",
              marginTop: space.lg,
            }}
          >
            Tap a day to see what's on.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

// --- shared ----------------------------------------------------------------

function Stepper({
  label,
  onBack,
  onNext,
}: {
  label: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: space.lg,
        paddingTop: space.lg,
      }}
    >
      <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Previous">
        <Text style={{ ...type.body, color: t.color.accent }}>‹ Back</Text>
      </Pressable>
      <Text style={{ ...type.label, color: t.color.text }}>{label}</Text>
      <Pressable onPress={onNext} hitSlop={12} accessibilityLabel="Next">
        <Text style={{ ...type.body, color: t.color.accent }}>Next ›</Text>
      </Pressable>
    </View>
  );
}

const startOfDay = (d: Date): Date =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

/** Monday-first, which is what a UK week looks like. */
function startOfWeek(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7;
  return addDays(d, -day);
}

const addDays = (d: Date, n: number): Date =>
  new Date(d.getTime() + n * 86_400_000);

const iso = (d: Date): string => d.toISOString().slice(0, 10);

const short = (d: Date): string =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
