import type { ReactNode } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";

import { radius, space, type, useTheme } from "@/theme";

export function Field({
  label,
  hint,
  hintOneLine,
  children,
}: {
  label: string;
  hint?: string;
  /**
   * Keeps a hint to a single line, shrinking slightly on narrow screens rather
   * than wrapping. Only worth it where the hint sits directly under a control
   * and a second line would push the form about as the user changes it.
   */
  hintOneLine?: boolean;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ ...type.label, color: t.color.textMuted }}>{label}</Text>
      {children}
      {hint ? (
        <Text
          numberOfLines={hintOneLine ? 1 : undefined}
          adjustsFontSizeToFit={hintOneLine}
          minimumFontScale={0.85}
          style={{ ...type.caption, color: t.color.textMuted }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  autoFocus,
  maxLength,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  const t = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={t.color.textMuted}
      autoFocus={autoFocus}
      maxLength={maxLength}
      style={{
        ...type.body,
        color: t.color.text,
        backgroundColor: t.color.surface,
        borderWidth: 1,
        borderColor: t.color.border,
        borderRadius: radius.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        padding: 3,
        gap: 3,
        borderRadius: radius.md,
        backgroundColor: t.color.surfaceAlt,
      }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: space.md - 2,
              borderRadius: radius.sm,
              backgroundColor: selected ? t.color.surface : "transparent",
            }}
          >
            <Text
              style={{
                ...type.label,
                color: selected ? t.color.text : t.color.textMuted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.lg,
        backgroundColor: t.color.surface,
        borderWidth: 1,
        borderColor: t.color.border,
        borderRadius: radius.md,
        padding: space.lg,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, color: t.color.text }}>{label}</Text>
        {hint ? (
          <Text style={{ ...type.caption, color: t.color.textMuted }}>{hint}</Text>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} />
    </Pressable>
  );
}

export function RowButton({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
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
        justifyContent: "space-between",
        backgroundColor: t.color.surface,
        borderWidth: 1,
        borderColor: t.color.border,
        borderRadius: radius.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    >
      <Text style={{ ...type.body, color: t.color.textMuted }}>{label}</Text>
      <Text style={{ ...type.body, color: t.color.text }}>{value}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={{
        alignItems: "center",
        paddingVertical: space.lg - 2,
        borderRadius: radius.pill,
        backgroundColor: disabled ? t.color.surfaceAlt : t.color.accent,
      }}
    >
      <Text
        style={{
          ...type.label,
          fontSize: 16,
          color: disabled ? t.color.textMuted : "#fff",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
