import { Ionicons } from "@expo/vector-icons";
import { Pressable, TextInput, View } from "react-native";

import { radius, space, type, useTheme } from "@/theme";

export function SearchBar({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const t = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: t.color.surfaceAlt,
      }}
    >
      <Ionicons name="search" size={17} color={t.color.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.color.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{
          flex: 1,
          paddingVertical: space.md,
          ...type.body,
          color: t.color.text,
        }}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange("")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={17} color={t.color.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}
