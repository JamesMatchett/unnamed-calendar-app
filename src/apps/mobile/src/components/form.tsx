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
  onBlur,
  autoCapitalize,
  bare = false,
  prefix,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  maxLength?: number;
  /**
   * For fields that SAVE rather than feed a submit button: profile name and
   * handle are committed when the field loses focus, since there is no Done to
   * press on a screen that has no form.
   */
  onBlur?: () => void;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  /** Drop the box: the Group around it already provides one. */
  bare?: boolean;
  /**
   * A fixed, unerasable lead-in such as "&". It sits OUTSIDE the input rather
   * than in its value, so nobody can delete it, the stored handle never carries
   * it, and a placeholder still reads as placeholder text.
   */
  prefix?: string;
}) {
  const t = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        ...(bare
          ? null
          : {
              backgroundColor: t.color.surface,
              borderWidth: 1,
              borderColor: t.color.border,
              borderRadius: radius.md,
              paddingHorizontal: space.lg,
            }),
      }}
    >
      {prefix ? (
        <Text style={{ ...type.body, color: t.color.textMuted, paddingRight: 2 }}>
          {prefix}
        </Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.color.textMuted}
        autoFocus={autoFocus}
        maxLength={maxLength}
        onBlur={onBlur}
        autoCapitalize={autoCapitalize}
        style={{
          ...type.body,
          flex: 1,
          color: t.color.text,
          paddingVertical: bare ? 0 : space.md,
        }}
      />
    </View>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  bare = false,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  /**
   * Drop the track and its padding, so the row can sit inside a SegmentedGroup
   * with another row. Two ordinary Segmenteds stacked read as two controls;
   * two bare rows in one track read as one control with a second row, which is
   * what a choice that only exists because of the row above it should look like.
   */
  bare?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 3,
        ...(bare
          ? null
          : {
              padding: 3,
              borderRadius: radius.md,
              backgroundColor: t.color.surfaceAlt,
            }),
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

/**
 * One track holding several Segmented rows, so a follow-up choice reads as a
 * sub-row of the choice that revealed it rather than as a new question.
 */
export function SegmentedGroup({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        padding: 3,
        gap: 3,
        borderRadius: radius.md,
        backgroundColor: t.color.surfaceAlt,
      }}
    >
      {children}
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  bare = false,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  /** Inside a Group the card provides the box and the padding. */
  bare?: boolean;
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
        ...(bare
          ? null
          : {
              backgroundColor: t.color.surface,
              borderWidth: 1,
              borderColor: t.color.border,
              borderRadius: radius.md,
              padding: space.lg,
            }),
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
  bare = false,
  active = false,
}: {
  label: string;
  value: string;
  onPress: () => void;
  /** Inside a Group the card provides the box and the padding. */
  bare?: boolean;
  /**
   * This row is the one the picker below is currently driving. Without it, a
   * sheet with several rows and one shared picker gives no clue which value is
   * about to change.
   */
  active?: boolean;
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
        ...(bare
          ? null
          : {
              backgroundColor: t.color.surface,
              borderWidth: 1,
              borderColor: t.color.border,
              borderRadius: radius.md,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
            }),
      }}
    >
      <Text style={{ ...type.body, color: t.color.textMuted }}>{label}</Text>
      <Text
        style={{
          ...type.body,
          fontWeight: active ? "700" : "400",
          color: active ? t.color.accent : t.color.text,
        }}
      >
        {value}
      </Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  variant = "solid",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * "ghost" is for the second of a pair, where both options are legitimate and
   * one is not a cancel: turning a suggestion down is an answer, so it gets a
   * real button rather than a link tucked under the primary one.
   */
  variant?: "solid" | "ghost";
}) {
  const t = useTheme();
  const ghost = variant === "ghost";

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
        borderWidth: ghost ? 1 : 0,
        borderColor: t.color.border,
        backgroundColor: disabled
          ? t.color.surfaceAlt
          : ghost
            ? t.color.surface
            : t.color.accent,
      }}
    >
      <Text
        style={{
          ...type.label,
          fontSize: 16,
          color: disabled
            ? t.color.textMuted
            : ghost
              ? t.color.text
              : "#fff",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
