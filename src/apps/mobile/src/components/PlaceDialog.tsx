import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useEffect, useState } from "react";

import { SearchBar } from "@/components/SearchBar";
import { Muted } from "@/components/ui";
import { recentPlaces } from "@/db/repo";
import { useQuery } from "@/lib/useQuery";
import { openMap } from "@/lib/maps";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Choosing where.
 *
 * The useful truth about a group calendar is that people go back to the same
 * dozen places, so the fastest picker is the one that offers those first: the
 * list is every location already used across your calendars, filtered as you
 * type. Typing something new is always available, because the thirteenth place
 * must not be harder to enter than the first twelve.
 *
 * There is deliberately NO map view yet. Drawing a map means a native map
 * dependency, and searching an address means a geocoder with an API key,
 * billing and a licence that dictates attribution — a provider decision rather
 * than a component. "Open in Maps" hands off to the device's own app in the
 * meantime, which is where anyone would go to check an address anyway.
 */
export function PlaceDialog({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: string;
  onSelect: (place: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState(value);

  useEffect(() => {
    if (visible) setQuery(value);
  }, [visible, value]);

  const places = useQuery("recent-places", () => recentPlaces());
  const typed = query.trim();
  const matches = places.filter((p) =>
    p.toLowerCase().includes(typed.toLowerCase()),
  );
  const exact = matches.some((p) => p.toLowerCase() === typed.toLowerCase());

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
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
          maxHeight: "80%",
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
          <Text style={{ ...type.heading, color: t.color.text }}>Where</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={{ ...type.label, color: t.color.accent }}>Cancel</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search or type a place"
          />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.xs }}
          keyboardShouldPersistTaps="handled"
        >
          {typed.length > 0 && !exact ? (
            <Row
              icon="add-circle-outline"
              label={`Use "${typed}"`}
              onPress={() => {
                onSelect(typed);
                onClose();
              }}
            />
          ) : null}

          {matches.map((place) => (
            <Row
              key={place}
              icon="time-outline"
              label={place}
              onPress={() => {
                onSelect(place);
                onClose();
              }}
            />
          ))}

          {typed.length > 0 ? (
            <Row
              icon="map-outline"
              label={`Look up "${typed}" in Maps`}
              onPress={() => void openMap({ name: typed })}
            />
          ) : null}

          {matches.length === 0 && typed.length === 0 ? (
            <Muted>
              Places you have used before appear here. Type anywhere else.
            </Muted>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Row({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: t.color.border,
        backgroundColor: t.color.surface,
      }}
    >
      <Ionicons name={icon} size={17} color={t.color.textMuted} />
      <Text style={{ ...type.body, flex: 1, color: t.color.text }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
