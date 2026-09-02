import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";

import { EventRow } from "@/components/EventRow";
import { EmptyState } from "@/components/ui";
import {
  getCalendar,
  listEvents,
  listMembers,
  listRsvpsForCalendar,
} from "@/db/repo";
import { dayKey, formatDayHeading } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { space } from "@/theme";

/** Everything planned on one day (§3.5). */
export default function DayScreen() {
  const { calendarId, date } = useLocalSearchParams<{
    calendarId: string;
    date: string;
  }>();

  const calendar = useQuery(`calendar:${calendarId}`, () => getCalendar(calendarId));
  const events = useQuery(`events:${calendarId}`, () => listEvents(calendarId));
  const members = useQuery(`members:${calendarId}`, () => listMembers(calendarId));
  const rsvps = useQuery(`rsvps:${calendarId}`, () => listRsvpsForCalendar(calendarId));

  const tz = calendar?.default_tz ?? "Europe/London";
  const onThisDay = events.filter((e) => dayKey(e.start_utc, tz) === date);

  return (
    <>
      <Stack.Screen
        options={{ title: formatDayHeading(`${date}T12:00:00.000Z`, tz) }}
      />
      {onThisDay.length === 0 ? (
        <EmptyState
          title="Nothing on this day"
          body="A free day is a feature, not a bug. Add something if you'd rather it weren't."
          actionLabel="Add an event"
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
          <View style={{ gap: space.sm }}>
            {onThisDay.map((e) => (
              <EventRow key={e.event_id} event={e} members={members} rsvps={rsvps} />
            ))}
          </View>
        </ScrollView>
      )}
    </>
  );
}
