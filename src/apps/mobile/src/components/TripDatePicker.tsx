import { Ionicons } from "@expo/vector-icons";
import type { DateRange, RangeField } from "@calder/core";
import {
  applyRangeTap,
  dayAtPoint,
  daysBetween,
  monthWeeks,
  moveEndpoint,
  positionIn,
  shiftMonth as shiftMonthBy,
  todayIn,
} from "@calder/core";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";

import { radius, space, type, useTheme } from "@/theme";

/**
 * A month grid where the calendar's own dates are emphasised and everything else
 * is dimmed but still selectable.
 *
 * The native date picker cannot express this: it offers minimum and maximum
 * dates, which *prevent* selection. That is the wrong rule here. People fly in
 * two days early or stay on for the weekend, and refusing to record it would
 * make the availability feature lie about who is around.
 *
 * So the range is presented as guidance rather than a constraint.
 */

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

const ROW_HEIGHT = 38;
/** Long enough not to fire while scrolling past, short enough not to feel stuck. */
const HOLD_MS = 220;

export function TripDatePicker({
  value,
  rangeStart,
  rangeEnd,
  tz,
  onSelect,
}: {
  /** YYYY-MM-DD, or null when nothing is chosen yet. */
  value: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  tz: string;
  onSelect: (date: string) => void;
}) {
  const t = useTheme();
  const today = todayIn(tz);
  const [visible, setVisible] = useState(
    (value ?? rangeStart ?? today).slice(0, 7),
  );

  const weeks = useMemo(() => monthWeeks(visible), [visible]);

  const inRange = (date: string) =>
    rangeStart !== null &&
    rangeEnd !== null &&
    date >= rangeStart &&
    date <= rangeEnd;

  const shiftMonth = (delta: number) => setVisible(shiftMonthBy(visible, delta));

  return (
    <View
      style={{
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: t.color.border,
        backgroundColor: t.color.surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={19} color={t.color.text} />
        </Pressable>
        <Text style={{ ...type.label, color: t.color.text }}>
          {new Date(`${visible}-01T12:00:00.000Z`).toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
          })}
        </Text>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={10} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={19} color={t.color.text} />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row" }}>
        {WEEKDAY_LABELS.map((d, i) => (
          <Text
            key={`${d}-${i}`}
            style={{
              ...type.caption,
              flex: 1,
              textAlign: "center",
              color: t.color.textMuted,
            }}
          >
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: "row" }}>
          {week.map((date, di) => {
            if (date === null) {
              return <View key={`blank-${di}`} style={{ flex: 1, height: 38 }} />;
            }

            const selected = date === value;
            const within = inRange(date);
            const isToday = date === today;

            return (
              <Pressable
                key={date}
                onPress={() => onSelect(date)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${date}${within ? "" : ", outside the calendar's dates"}`}
                style={{
                  flex: 1,
                  height: ROW_HEIGHT,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.sm,
                  backgroundColor: selected
                    ? t.color.accent
                    : within
                      ? t.color.accentSoft
                      : "transparent",
                }}
              >
                <Text
                  style={{
                    ...type.body,
                    fontSize: 15,
                    // Outside the range stays legible rather than disabled: it is
                    // a hint about the trip, not a rule about the person.
                    color: selected
                      ? "#fff"
                      : within
                        ? t.color.text
                        : t.color.textMuted,
                    fontWeight: selected || isToday ? "700" : "400",
                  }}
                >
                  {Number(date.slice(8))}
                </Text>
                {isToday && !selected ? (
                  <View
                    style={{
                      position: "absolute",
                      bottom: 4,
                      width: 3,
                      height: 3,
                      borderRadius: radius.pill,
                      backgroundColor: t.color.accentFill,
                    }}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}

      {rangeStart && rangeEnd ? (
        <Text style={{ ...type.caption, color: t.color.textMuted }}>
          Shaded days are the calendar's dates. You can still pick others if
          you're arriving early or staying on.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Both ends of a trip on one grid.
 *
 * The native inline picker knows about one date, so choosing a start and an end
 * meant two pickers, one at a time, and no way to see the shape of the thing
 * you were choosing. A trip is a span, not two unrelated days: seeing the bar
 * between them is the whole point, and "four nights" is a fact you read off the
 * picture rather than work out.
 *
 * The two rows above stay, because they say which end a tap will move and are
 * the only affordance that explains an otherwise ambiguous grid. Which one is
 * live is shown the same way the time sheet shows it: the accent colour on the
 * value, and it advances by itself once the start is set.
 */
export function RangeCalendar({
  range,
  editing,
  tz,
  onChange,
}: {
  range: DateRange;
  /** Which end the next tap moves. */
  editing: RangeField;
  tz: string;
  onChange: (next: { range: DateRange; editing: RangeField }) => void;
}) {
  const t = useTheme();
  const today = todayIn(tz);
  const [visible, setVisible] = useState(range.start.slice(0, 7));
  const weeks = useMemo(() => monthWeeks(visible), [visible]);
  const [width, setWidth] = useState(0);
  /** Which end the finger is carrying, or null when nobody is dragging. */
  const [dragging, setDragging] = useState<RangeField | null>(null);
  /** The hold has registered, but the finger has not moved yet. */
  const [holding, setHolding] = useState<RangeField | null>(null);

  /**
   * Hold an end, then drag it.
   *
   * Tapping already moves whichever end is highlighted, which is quick but
   * says nothing about the range being shaped. Dragging an end is the gesture
   * the picture invites: the bar grows and shrinks under the finger, so the
   * length of the trip is felt rather than read.
   *
   * It waits for a hold rather than starting on contact, because this grid
   * lives inside a scrolling form: a drag that began the moment a finger
   * landed on a date would swallow every attempt to scroll past it. The hold
   * is also what keeps a tap a tap.
   *
   * PanResponder rather than a gesture library, deliberately. The modern
   * gesture API needs a native module version that has to match whatever the
   * host app was built with, and in Expo Go it does not: the JS calls a native
   * method the bundled binary has never heard of. PanResponder is part of React
   * Native itself, so there is no version to line up, and this gesture is
   * simple enough not to need anything cleverer.
   */
  const live = useRef({
    range,
    field: null as RangeField | null,
    /** When the finger went down, and where, in window coordinates. */
    downAt: 0,
    origin: { x: 0, y: 0 },
  });
  live.current.range = range;

  const gridRef = useRef<View>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const dayAt = (pageX: number, pageY: number): string | null =>
    width === 0
      ? null
      : dayAtPoint({
          x: pageX - live.current.origin.x,
          y: pageY - live.current.origin.y,
          width,
          rowHeight: ROW_HEIGHT,
          rowGap: 0,
          weeks,
        });

  const responder = useMemo(
    () =>
      PanResponder.create({
        /**
         * Capture, and deliberately return false: this watches the touch begin
         * without claiming it, so the day underneath still handles a tap and
         * the form still scrolls.
         *
         * The grid is measured here rather than at layout because it sits in a
         * scroll view, where its position on screen changes without any layout
         * happening at all.
         */
        onStartShouldSetPanResponderCapture: (e) => {
          const { pageX, pageY } = e.nativeEvent;
          live.current.downAt = Date.now();
          live.current.field = null;
          if (holdTimer.current) clearTimeout(holdTimer.current);

          gridRef.current?.measureInWindow((x, y) => {
            live.current.origin = { x, y };
            const day = dayAt(pageX, pageY);
            const where = day ? positionIn(day, live.current.range) : "none";
            // Only the ends are draggable. Grabbing the middle of the bar to
            // slide the whole range is a different gesture and a different
            // promise, and offering it by accident would move both dates.
            live.current.field =
              where === "start" || where === "only"
                ? "start"
                : where === "end"
                  ? "end"
                  : null;

            // Purely so the hold is visibly acknowledged before anything
            // moves. The drag itself is gated on elapsed time, not on this.
            if (live.current.field) {
              holdTimer.current = setTimeout(
                () => setHolding(live.current.field),
                HOLD_MS,
              );
            }
          });
          return false;
        },

        // A drag is a move that comes after a hold on one of the ends. Moving
        // sooner than that is somebody scrolling the form.
        onMoveShouldSetPanResponder: () =>
          live.current.field !== null && Date.now() - live.current.downAt >= HOLD_MS,

        onPanResponderGrant: () => setDragging(live.current.field),

        onPanResponderMove: (e) => {
          const field = live.current.field;
          if (!field) return;
          const day = dayAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
          // Off the grid: hold the last good day rather than snapping the end
          // somewhere arbitrary or dropping the drag.
          if (!day) return;
          const next = moveEndpoint(live.current.range, field, day);
          if (
            next.range.start === live.current.range.start &&
            next.range.end === live.current.range.end
          ) {
            return;
          }
          // After a swap the day under the finger is the OTHER end, and the
          // drag has to follow it or the finger ends up moving the wrong date.
          live.current.field = next.field;
          setDragging(next.field);
          onChange({ range: next.range, editing: next.field });
        },

        onPanResponderEnd: () => {
          live.current.field = null;
          if (holdTimer.current) clearTimeout(holdTimer.current);
          setDragging(null);
          setHolding(null);
        },
      }),
    [weeks, width, onChange],
  );

  const carrying = dragging ?? holding;

  return (
    <Frame
      month={visible}
      onShift={(delta) => setVisible(shiftMonthBy(visible, delta))}
      footer={
        <Text style={{ ...type.caption, color: t.color.textMuted }}>
          {carrying
            ? `${nights(range)}. Let go to keep it.`
            : `${nights(range)}. Tap a day to move whichever of Starts or Ends is highlighted, or hold one end and drag it.`}
        </Text>
      }
    >
      {/* No gap between the rows: the bar has to be continuous down a week
          boundary as well as across one, and the drag arithmetic wants a grid
          it can divide rather than one with holes in it. */}
      <View
        ref={gridRef}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        {...responder.panHandlers}
      >
      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: "row" }}>
          {week.map((date, di) => {
            if (date === null) {
              return <View key={`blank-${di}`} style={{ flex: 1, height: 38 }} />;
            }

            const where = positionIn(date, range);
            const isEnd = where === "start" || where === "end" || where === "only";
            // The span is one continuous bar, so the fill runs edge to edge and
            // only the outermost corners are rounded. Squaring the inner edge of
            // each end is what joins the bar to them rather than leaving two
            // pills with a stripe between.
            const round = (corner: "left" | "right") =>
              where === "only" ||
              (corner === "left" && where === "start") ||
              (corner === "right" && where === "end")
                ? radius.sm
                : 0;

            return (
              <Pressable
                key={date}
                onPress={() => onChange(applyRangeTap(range, editing, date))}
                accessibilityRole="button"
                accessibilityState={{ selected: isEnd }}
                accessibilityLabel={label(date, where)}
                style={{
                  flex: 1,
                  height: ROW_HEIGHT,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isEnd
                    ? t.color.accentFill
                    : where === "between"
                      ? t.color.accentSoft
                      : "transparent",
                  // The end being carried is ringed rather than moved or
                  // scaled: it is already under a fingertip, so the feedback
                  // has to survive being covered by one.
                  borderWidth: carrying === where ? 2 : 0,
                  borderColor: t.color.text,
                  borderTopLeftRadius: round("left"),
                  borderBottomLeftRadius: round("left"),
                  borderTopRightRadius: round("right"),
                  borderBottomRightRadius: round("right"),
                }}
              >
                <Text
                  style={{
                    ...type.body,
                    fontSize: 15,
                    color: isEnd
                      ? t.color.onAccent
                      : where === "between"
                        ? t.color.text
                        : t.color.textMuted,
                    fontWeight: isEnd || date === today ? "700" : "400",
                  }}
                >
                  {Number(date.slice(8))}
                </Text>
                {date === today && !isEnd ? (
                  <View
                    style={{
                      position: "absolute",
                      bottom: 4,
                      width: 3,
                      height: 3,
                      borderRadius: radius.pill,
                      backgroundColor: t.color.accentFill,
                    }}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      </View>
    </Frame>
  );
}

/** The card, the month heading and its arrows: the same chrome for both grids. */
function Frame({
  month,
  onShift,
  footer,
  children,
}: {
  month: string;
  onShift: (delta: number) => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const t = useTheme();

  return (
    <View
      style={{
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: t.color.border,
        backgroundColor: t.color.surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Pressable onPress={() => onShift(-1)} hitSlop={10} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={19} color={t.color.text} />
        </Pressable>
        <Text style={{ ...type.label, color: t.color.text }}>
          {new Date(`${month}-01T12:00:00.000Z`).toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
          })}
        </Text>
        <Pressable onPress={() => onShift(1)} hitSlop={10} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={19} color={t.color.text} />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row" }}>
        {WEEKDAY_LABELS.map((d, i) => (
          <Text
            key={`${d}-${i}`}
            style={{
              ...type.caption,
              flex: 1,
              textAlign: "center",
              color: t.color.textMuted,
            }}
          >
            {d}
          </Text>
        ))}
      </View>

      {children}
      {footer}
    </View>
  );
}

/** "Four nights", so the length of the trip is a word and not a subtraction. */
function nights(range: DateRange): string {
  const n = daysBetween(range.start, range.end);
  if (n === 0) return "One day";
  return `${n} night${n === 1 ? "" : "s"}`;
}

const label = (date: string, where: string): string =>
  where === "start"
    ? `${date}, the first day`
    : where === "end"
      ? `${date}, the last day`
      : where === "only"
        ? `${date}, the only day`
        : date;
