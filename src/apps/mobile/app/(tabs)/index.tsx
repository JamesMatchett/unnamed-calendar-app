import { useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { EventRow } from "@/components/EventRow";
import { EmptyState, SyncBanner } from "@/components/ui";
import {
  listAgenda,
  listMembers,
  listRsvpsForCalendar,
  pendingMutationCount,
} from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import { formatDayHeading } from "@/lib/format";
import { space, type, useTheme } from "@/theme";

/**
 * Home. Everything I am doing across every calendar (access pattern 13).
 *
 * It falls through to Calendars when empty, because an empty home screen for a
 * new user is how apps die in week one (§3.5).
 */
export default function AgendaScreen() {
  const t = useTheme();
  const router = useRouter();

  const events = useQuery("agenda", () => listAgenda());
  const pending = useQuery("pending", () => pendingMutationCount());

  if (events.length === 0) {
    return (
      <EmptyState
        title="Nothing coming up"
        body="Your agenda fills in as friends add events to calendars you're part of."
        actionLabel="Go to calendars"
        onAction={() => router.push("/calendars")}
      />
    );
  }

  const groups = new Map<string, typeof events>();
  for (const e of events) {
    const key = e.start_utc.slice(0, 10);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner pending={pending} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {[...groups.entries()].map(([dayIso, dayEvents]) => (
          <View key={dayIso} style={{ gap: space.sm }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>
              {formatDayHeading(`${dayIso}T12:00:00.000Z`, "UTC")}
            </Text>
            {dayEvents.map((e) => (
              <AgendaItem key={e.event_id} event={e} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
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
