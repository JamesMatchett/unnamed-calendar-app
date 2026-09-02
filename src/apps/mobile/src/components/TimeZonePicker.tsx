import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { describeZone, offsetLabel, searchTimeZones } from "@/lib/timezones";
import { radius, space, type, useTheme } from "@/theme";

import { SearchBar } from "./SearchBar";

/**
 * A modal rather than a route, so the choice comes straight back as a value.
 * Routing to a picker means inventing a way to return a result, which is a lot
 * of machinery for one string.
 */
export function TimeZonePicker({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: string;
  onSelect: (tz: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState("");
  const zones = searchTimeZones(query);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.color.bg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: space.lg,
            paddingTop: space.xxl + space.lg,
          }}
        >
          <Text style={{ ...type.heading, color: t.color.text }}>Time zone</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={{ ...type.label, color: t.color.accent }}>Done</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search a city or region"
          />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.xs }}
          keyboardShouldPersistTaps="handled"
        >
          {zones.length === 0 ? (
            <Text style={{ ...type.caption, color: t.color.textMuted }}>
              Nothing matching "{query.trim()}".
            </Text>
          ) : (
            zones.map((z) => {
              const { city, region } = describeZone(z);
              const selected = z === current;
              return (
                <Pressable
                  key={z}
                  onPress={() => {
                    onSelect(z);
                    onClose();
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                    borderRadius: radius.sm,
                    backgroundColor: selected ? t.color.accentSoft : "transparent",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        ...type.body,
                        color: selected ? t.color.accent : t.color.text,
                      }}
                    >
                      {city}
                    </Text>
                    {region ? (
                      <Text style={{ ...type.caption, color: t.color.textMuted }}>
                        {region}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={{ ...type.caption, color: t.color.textMuted }}>
                    {offsetLabel(z)}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
