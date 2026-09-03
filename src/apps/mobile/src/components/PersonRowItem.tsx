import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import type { PersonRow, SuggestionRow } from "@/db/repo";
import { radius, space, type, useTheme } from "@/theme";

import { AvatarStack } from "./ui";

type Action = { label: string; onPress: () => void; tone?: "primary" | "quiet" };

/**
 * One person, wherever they appear — search results, suggestions, the friends
 * list. Kept in one component so a person looks identical everywhere and the
 * available action is always the same shape.
 */
export function PersonRowItem({
  person,
  context,
  contextTone,
  actions,
}: {
  person: PersonRow | SuggestionRow;
  context?: string;
  /** Emphasised when the subtext is a disclosure rather than a fact (§7.4). */
  contextTone?: "muted" | "notice";
  actions: readonly Action[];
}) {
  const t = useTheme();

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <AvatarStack names={[person.display_name]} />

      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ ...type.body, fontSize: 15, color: t.color.text }}>
          {person.display_name}
        </Text>
        <Text
          style={{
            ...type.caption,
            color: contextTone === "notice" ? t.color.accent : t.color.textMuted,
          }}
        >
          &{person.handle}
          {context ? ` · ${context}` : ""}
        </Text>
      </View>

      {actions.map((a) => (
        <Pressable
          key={a.label}
          onPress={a.onPress}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${a.label}, ${person.display_name}`}
          style={{
            paddingHorizontal: space.md,
            paddingVertical: 7,
            borderRadius: radius.pill,
            backgroundColor:
              a.tone === "primary" ? t.color.accent : "transparent",
            borderWidth: a.tone === "primary" ? 0 : 1,
            borderColor: t.color.border,
          }}
        >
          <Text
            style={{
              ...type.caption,
              fontWeight: "600",
              color: a.tone === "primary" ? "#fff" : t.color.textMuted,
            }}
          >
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Non-interactive states: already friends, or a request already in flight. */
export function PersonState({ status }: { status: "accepted" | "pending_out" }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Ionicons
        name={status === "accepted" ? "checkmark-circle" : "time-outline"}
        size={15}
        color={t.color.textMuted}
      />
      <Text style={{ ...type.caption, color: t.color.textMuted }}>
        {status === "accepted" ? "Friends" : "Requested"}
      </Text>
    </View>
  );
}
