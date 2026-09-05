import { Ionicons } from "@expo/vector-icons";
import type { DateRange, RangeField } from "@calder/core";
import {
  applyRangeTap,
  daysBetween,
  isBackwards,
  monthWeeks,
  positionIn,
  shiftMonth as shiftMonthBy,
  todayIn,
} from "@calder/core";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

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
                  height: 38,
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
  // A range that ends before it begins has no span to draw, so the two days
  // stand alone in the danger colour and the footer says what is wrong.
  const backwards = isBackwards(range);

  return (
    <Frame
      month={visible}
      onShift={(delta) => setVisible(shiftMonthBy(visible, delta))}
      footer={
        backwards ? (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
            <Ionicons name="alert-circle" size={16} color={t.color.danger} />
            <Text style={{ ...type.caption, flex: 1, color: t.color.danger }}>
              This ends before it starts. Pick a last day on or after{" "}
              {readable(range.start)}.
            </Text>
          </View>
        ) : (
          <Text style={{ ...type.caption, color: t.color.textMuted }}>
            {nights(range)}. Tap a day to move whichever of Starts or Ends is
            highlighted above.
          </Text>
        )
      }
    >
      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: "row" }}>
          {week.map((date, di) => {
            if (date === null) {
              return <View key={`blank-${di}`} style={{ flex: 1, height: 38 }} />;
            }

            // With the range inverted there is no "between", so the two ends
            // are marked on their own rather than shading half the month.
            const where = backwards
              ? date === range.start
                ? "start"
                : date === range.end
                  ? "end"
                  : "none"
              : positionIn(date, range);
            const isEnd = where === "start" || where === "end" || where === "only";
            // The span is one continuous bar, so the fill runs edge to edge and
            // only the outermost corners are rounded. Squaring the inner edge of
            // each end is what joins the bar to them rather than leaving two
            // pills with a stripe between.
            const round = (corner: "left" | "right") =>
              backwards ||
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
                  height: 38,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isEnd
                    ? backwards
                      ? t.color.danger
                      : t.color.accentFill
                    : where === "between"
                      ? t.color.accentSoft
                      : "transparent",
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

const readable = (date: string): string =>
  new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

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
