import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/form";
import { Card, EmptyState, Muted } from "@/components/ui";
import type { EventRow, SuggestedChanges } from "@/db/repo";
import {
  SUGGESTABLE_FIELDS,
  getEvent,
  getSuggestion,
  parseChanges,
  pendingSuggestionForEvent,
  resolveSuggestion,
} from "@/db/repo";
import { formatDayHeading, formatClock } from "@/lib/format";
import { useQuery } from "@/lib/useQuery";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Approve or deny a suggested change (§8.1).
 *
 * The screen is a DIFF rather than a filled-in edit form, because the question
 * an owner is answering is "should this change?" and not "what should this be?".
 * Showing only the fields that moved, old beside new, makes that answerable in a
 * couple of seconds; an edit form makes it a chore and invites accidental edits
 * to fields nobody proposed changing.
 *
 * Reached by its EVENT id, since that is what a notification carries: the
 * suggestion itself may have been withdrawn before the tap arrives.
 */
export default function SuggestionScreen() {
  const t = useTheme();
  const router = useRouter();
  const { eventId, suggestionId } = useLocalSearchParams<{
    eventId?: string;
    suggestionId?: string;
  }>();

  const suggestion = useQuery(`suggestion:${suggestionId ?? eventId}`, () =>
    suggestionId
      ? getSuggestion(suggestionId)
      : eventId
        ? pendingSuggestionForEvent(eventId)
        : null,
  );

  const event = useQuery(`event:${suggestion?.event_id ?? ""}`, () =>
    suggestion ? getEvent(suggestion.event_id) : null,
  );

  if (!suggestion || !event) {
    return (
      <>
        <Stack.Screen options={{ title: "Suggestion" }} />
        <EmptyState
          title="Nothing to answer"
          body="This suggestion was withdrawn or has already been dealt with."
        />
      </>
    );
  }

  if (suggestion.status !== "pending") {
    return (
      <>
        <Stack.Screen options={{ title: "Suggestion" }} />
        <EmptyState
          title={
            suggestion.status === "accepted"
              ? "Already applied"
              : "Already turned down"
          }
          body={`You answered this suggestion from ${suggestion.suggested_by_name}.`}
        />
      </>
    );
  }

  const changes = parseChanges(suggestion);
  const rows = SUGGESTABLE_FIELDS.filter((f) => f in changes).map((field) => ({
    field,
    label: LABELS[field],
    before: describe(field, event),
    after: describeValue(field, changes, event),
  })).filter((r) => r.before !== r.after);

  const answer = (approve: boolean) => {
    resolveSuggestion(suggestion.suggestion_id, approve);
    router.back();
  };

  return (
    <>
      <Stack.Screen
        options={{ title: "Suggested change" }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.title, color: t.color.text }}>
            {event.title}
          </Text>
          <Muted>
            {suggestion.suggested_by_name} suggested{" "}
            {rows.length === 1 ? "a change" : `${rows.length} changes`}
          </Muted>
        </View>

        {suggestion.note ? (
          <Card style={{ gap: space.xs }}>
            <Text style={{ ...type.label, color: t.color.textMuted }}>
              Why
            </Text>
            <Text style={{ ...type.body, color: t.color.text }}>
              {suggestion.note}
            </Text>
          </Card>
        ) : null}

        {rows.length === 0 ? (
          <Muted>Nothing in this suggestion differs from the event.</Muted>
        ) : (
          <View style={{ gap: space.sm }}>
            {rows.map((row) => (
              <Card key={row.field} style={{ gap: space.sm }}>
                <Text style={{ ...type.label, color: t.color.textMuted }}>
                  {row.label}
                </Text>

                {/* Old above new, each labelled and coloured, rather than a
                    single "was X, now Y" line: at a glance the eye should be
                    able to find what is being taken away and what replaces it. */}
                <Line
                  tone={t.color.notGoing}
                  icon="remove-circle-outline"
                  text={row.before}
                  strike
                />
                <Line
                  tone={t.color.going}
                  icon="add-circle-outline"
                  text={row.after}
                />
              </Card>
            ))}
          </View>
        )}

        <View style={{ gap: space.sm }}>
          <PrimaryButton
            label="Approve the change"
            onPress={() => answer(true)}
          />
          <PrimaryButton
            label="Keep it as it is"
            variant="ghost"
            onPress={() => answer(false)}
          />
          <Muted>
            Either way {suggestion.suggested_by_name} is told what you decided.
          </Muted>
        </View>
      </ScrollView>
    </>
  );
}

function Line({
  tone,
  icon,
  text,
  strike,
}: {
  tone: string;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  strike?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.sm,
        backgroundColor: t.color.surfaceAlt,
      }}
    >
      <Ionicons name={icon} size={17} color={tone} style={{ marginTop: 1 }} />
      <Text
        style={{
          ...type.body,
          flex: 1,
          color: strike ? t.color.textMuted : t.color.text,
          textDecorationLine: strike ? "line-through" : "none",
        }}
      >
        {text}
      </Text>
    </View>
  );
}

type Field = (typeof SUGGESTABLE_FIELDS)[number];

const LABELS: Record<Field, string> = {
  title: "Name",
  start_utc: "Starts",
  end_utc: "Ends",
  location_name: "Where",
  location_address: "Address",
  description: "Details",
};

const EMPTY = "Not set";

function describe(field: Field, event: EventRow): string {
  const value = event[field];
  return render(field, typeof value === "string" ? value : null, event.tz);
}

function describeValue(
  field: Field,
  changes: SuggestedChanges,
  event: EventRow,
): string {
  return render(field, changes[field] ?? null, event.tz);
}

function render(field: Field, value: string | null, tz: string): string {
  if (!value) return EMPTY;
  if (field === "start_utc") {
    return `${formatDayHeading(value, tz)}, ${formatClock(value, tz)}`;
  }
  if (field === "end_utc") return formatClock(value, tz);
  return value;
}
