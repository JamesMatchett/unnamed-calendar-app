import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { PrimaryButton, RowButton } from "@/components/form";
import { Group, Muted } from "@/components/ui";
import { radius, space, type, useTheme } from "@/theme";

export interface SlotDraft {
  /** YYYY-MM-DD, local to the calendar's zone. */
  date: string;
  /** HH:MM, 24h. */
  time: string;
  /** HH:MM, 24h. Null when the event has no stated finish. */
  endTime?: string | null;
}

/**
 * Compose one time: a date, a start, and optionally a finish.
 *
 * A dialogue rather than rows on the form, because adding options is a small
 * repeated loop — pick, add, pick, add — and pickers living inline push the
 * rest of the form around on every pass. It doubles as the editor for a value
 * already set, since "change it" and "add another" are the same act with a
 * different starting point.
 *
 * Start and end live in the SAME sheet. They were two sheets built from these
 * identical rows, which meant the only thing telling you which one you had open
 * was a heading you had already scrolled past — and a start without its end on
 * screen is half a decision. One sheet, with the row currently driving the
 * picker highlighted, so there is never a question about what the wheel below
 * is changing.
 */
export function SlotDialog({
  visible,
  initial,
  tz,
  title,
  saveLabel,
  dateLabel = "Date",
  timeLabel = "Time",
  removeLabel = "Remove this option",
  withTime = true,
  withEnd = false,
  onSave,
  onRemove,
  onClose,
}: {
  visible: boolean;
  /** Editing an existing value, or null to compose a new one. */
  initial: SlotDraft | null;
  tz: string;
  /** Overrides the poll wording when this is the event's own date. */
  title?: string;
  saveLabel?: string;
  /** Row labels, so the sheet says what it is setting. */
  dateLabel?: string;
  timeLabel?: string;
  removeLabel?: string;
  /** All-day events have no time to pick. */
  withTime?: boolean;
  /** Poll options are a start only; the event's own time can also finish. */
  withEnd?: boolean;
  onSave: (draft: SlotDraft) => void;
  /** Absent when adding: there is nothing yet to remove. */
  onRemove?: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [date, setDate] = useState(initial?.date ?? today());
  const [time, setTime] = useState(initial?.time ?? "19:00");
  const [endTime, setEndTime] = useState<string | null>(initial?.endTime ?? null);
  const [picking, setPicking] = useState<"date" | "time" | "end">("date");

  // Reopening for a different option must start from THAT option, not from
  // whatever was last edited.
  useEffect(() => {
    if (!visible) return;
    setDate(initial?.date ?? today());
    setTime(initial?.time ?? "19:00");
    setEndTime(initial?.endTime ?? null);
    setPicking("date");
  }, [visible, initial?.date, initial?.time, initial?.endTime]);

  const overnight = endTime !== null && endTime < time;
  // The wheel edits whichever row is highlighted, so it has to be pointed at
  // that row's value.
  const pickingTime = withTime && picking !== "date";
  const pickerValue =
    picking === "end" && endTime !== null
      ? new Date(`${date}T${endTime}:00`)
      : new Date(`${date}T${time}:00`);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}
      />
      <View
        style={{
          backgroundColor: t.color.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingBottom: space.xxl,
          maxHeight: "85%",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: space.lg,
          }}
        >
          <Text style={{ ...type.heading, color: t.color.text }}>
            {title ?? (initial ? "Change this option" : "Add an option")}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={{ ...type.label, color: t.color.accent }}>Cancel</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}
        >
          <Group>
            <RowButton
              bare
              label={dateLabel}
              value={pretty(date)}
              active={picking === "date"}
              onPress={() => setPicking("date")}
            />
            {withTime ? (
              <RowButton
                bare
                label={timeLabel}
                value={time}
                active={picking === "time"}
                onPress={() => setPicking("time")}
              />
            ) : null}

            {withTime && withEnd ? (
              endTime !== null ? (
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
                >
                  <View style={{ flex: 1 }}>
                    <RowButton
                      bare
                      label="Ends"
                      value={`${endTime}${overnight ? " next day" : ""}`}
                      active={picking === "end"}
                      onPress={() => setPicking("end")}
                    />
                  </View>
                  <Pressable
                    onPress={() => {
                      setEndTime(null);
                      if (picking === "end") setPicking("time");
                    }}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Remove the end time"
                  >
                    <Text style={{ ...type.caption, color: t.color.textMuted }}>
                      Clear
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    setEndTime(plusHours(time, 2));
                    setPicking("end");
                  }}
                  accessibilityRole="button"
                >
                  <Text style={{ ...type.body, color: t.color.accent }}>
                    Add an end time
                  </Text>
                </Pressable>
              )
            ) : null}
          </Group>

          {/* A wheel for a time, a grid for a date. iOS's "inline" display is a
              month calendar: asked for a time it still draws the calendar, so
              tapping Ends looked like it had done nothing at all. */}
          <DateTimePicker
            value={pickerValue}
            mode={pickingTime ? "time" : "date"}
            display={
              Platform.OS !== "ios" ? "default" : pickingTime ? "spinner" : "inline"
            }
            // The spinner sizes itself to its columns and then sits wherever
            // the row leaves it, which reads as off-centre under rows that are
            // full width. Letting it shrink to its content and centring that
            // puts the wheel under the middle of the sheet.
            style={pickingTime ? { alignSelf: "center" } : undefined}
            onChange={(_, selected) => {
              if (!selected) return;
              if (picking === "date") {
                setDate(selected.toISOString().slice(0, 10));
                return;
              }
              const hhmm = `${String(selected.getHours()).padStart(2, "0")}:${String(
                selected.getMinutes(),
              ).padStart(2, "0")}`;
              if (picking === "end") setEndTime(hhmm);
              else setTime(hhmm);
            }}
          />

          <Muted>
            {overnight
              ? `Finishes after midnight, so it runs into the next day. Times are in the calendar's zone, ${tz}.`
              : `Times are in the calendar's zone, ${tz}.`}
          </Muted>

          <PrimaryButton
            label={saveLabel ?? (initial ? "Save this option" : "Add this option")}
            onPress={() => {
              onSave({ date, time, endTime: withEnd ? endTime : null });
              onClose();
            }}
          />

          {onRemove ? (
            <Pressable
              onPress={() => {
                onRemove();
                onClose();
              }}
              accessibilityRole="button"
            >
              <Text
                style={{
                  ...type.label,
                  color: t.color.danger,
                  textAlign: "center",
                  paddingVertical: space.md,
                }}
              >
                {removeLabel}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Default finish, kept inside the same day so it reads as a normal evening. */
const plusHours = (hhmm: string, hours: number): string => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const end = (h + hours) % 24;
  return `${String(end).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const pretty = (iso: string): string =>
  new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
