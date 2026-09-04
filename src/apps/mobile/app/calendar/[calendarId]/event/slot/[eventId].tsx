import DateTimePicker from "@react-native-community/datetimepicker";
import { zonedWallToUtc } from "@calder/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";

import { Field, PrimaryButton, RowButton, Segmented } from "@/components/form";
import { Muted } from "@/components/ui";
import { getCalendar, getEvent, proposeSlot } from "@/db/repo";
import { formatDayShort } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { space } from "@/theme";

/**
 * Put a time forward for a poll.
 *
 * Its own screen rather than an inline row, because proposing is a considered
 * act — you are asking several people to answer it — and because a date picker
 * unfolding inside a list of slots pushes everything else off the screen.
 */
export default function ProposeSlotScreen() {
  const router = useRouter();
  const { calendarId, eventId } = useLocalSearchParams<{
    calendarId: string;
    eventId: string;
  }>();

  const event = useQuery(`event:${eventId}`, () => getEvent(eventId));
  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const tz = event?.tz ?? calendar?.default_tz ?? "Europe/London";

  const [precision, setPrecision] = useState<"datetime" | "date">("datetime");
  const [date, setDate] = useState(
    event?.local_wall?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [time, setTime] = useState("19:00");
  const [picking, setPicking] = useState<"date" | "time" | null>(null);

  const wall = `${date}T${precision === "datetime" ? time : "12:00"}:00`;

  const add = () => {
    proposeSlot(eventId, {
      startUtc: zonedWallToUtc(wall, tz),
      tz,
      localWall: wall,
      precision,
    });
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: "Suggest a time", presentation: "modal" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <Field label="When">
          <Segmented<"datetime" | "date">
            value={precision}
            onChange={setPrecision}
            options={[
              { value: "datetime", label: "At a time" },
              { value: "date", label: "All day" },
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

        <PrimaryButton label="Put this time forward" onPress={add} />
        <Muted>
          Suggesting the same time as someone else adds your answer to theirs
          rather than splitting the vote.
        </Muted>
      </ScrollView>
    </>
  );
}
