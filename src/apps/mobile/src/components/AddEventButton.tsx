import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { listCalendarsICanPostTo } from "@/db/repo";
import { formatDateRange } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Add an event from the agenda, where no calendar is implied.
 *
 * On a calendar screen the destination is obvious and the button goes straight
 * to the form. Here it is not, so the calendar is asked for first: an event has
 * to belong somewhere, and guessing would file a Friday five-a-side into a
 * holiday. The picker is a modal rather than a route because the answer comes
 * straight back as a value (same reasoning as TimeZonePicker).
 *
 * One eligible calendar means there is nothing to choose, so it skips the sheet
 * entirely rather than asking a question with one answer.
 */
export function AddEventButton() {
  const t = useTheme();
  const router = useRouter();
  const [picking, setPicking] = useState(false);

  const calendars = useQuery("post-to", () => listCalendarsICanPostTo());
  if (calendars.length === 0) return null;

  const open = (calendarId: string) => {
    setPicking(false);
    router.push({
      pathname: "/calendar/[calendarId]/event/new",
      params: { calendarId },
    });
  };

  return (
    <>
      <Pressable
        onPress={() => {
          const only = calendars.length === 1 ? calendars[0] : null;
          if (only) open(only.calendar_id);
          else setPicking(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Add an event"
        style={{
          position: "absolute",
          right: space.lg,
          bottom: space.xl,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.xl,
          paddingVertical: space.md,
          borderRadius: radius.pill,
          backgroundColor: t.color.accentFill,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Ionicons name="add" size={19} color={t.color.onAccent} />
        <Text style={{ ...type.label, color: t.color.onAccent }}>Add</Text>
      </Pressable>

      <Modal
        visible={picking}
        transparent
        animationType="slide"
        onRequestClose={() => setPicking(false)}
      >
        {/* A sheet, not a full screen: picking a calendar is one tap, and
            covering the agenda for it would lose the context you are adding
            from. */}
        <Pressable
          onPress={() => setPicking(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}
        />
        <View
          style={{
            backgroundColor: t.color.bg,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingBottom: space.xxl,
            maxHeight: "70%",
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
              Add to which calendar?
            </Text>
            <Pressable
              onPress={() => setPicking(false)}
              hitSlop={10}
              accessibilityRole="button"
            >
              <Text style={{ ...type.label, color: t.color.accent }}>Cancel</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
            {calendars.map((c) => {
              const range = formatDateRange(
                c.start_date ?? undefined,
                c.end_date ?? undefined,
              );
              return (
                <Pressable
                  key={c.calendar_id}
                  onPress={() => open(c.calendar_id)}
                  accessibilityRole="button"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    padding: space.lg,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: t.color.border,
                    backgroundColor: t.color.surface,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...type.body, color: t.color.text }}>
                      {c.name}
                    </Text>
                    <Text style={{ ...type.caption, color: t.color.textMuted }}>
                      {range ?? "Ongoing"}
                      {c.my_role === "owner" ? " · You own this" : ""}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={t.color.textMuted}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
