import type { ReactNode } from "react";
import { Children } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { radius, space, type, useTheme } from "@/theme";

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.color.surface,
          borderColor: t.color.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.md,
          padding: space.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * A group of related rows in one card, divided by hairlines.
 *
 * The form used to be a stack of separate white boxes on grey, each the same
 * size with the same gap, which grouped nothing and gave the eye no rhythm.
 * Related things in one card with dividers is both the platform convention and
 * about half the visual noise for the same content.
 *
 * Rows are plain content: the card owns the padding, the background and the
 * separators, so nothing inside needs its own border.
 */
export function Group({ children }: { children: ReactNode }) {
  const t = useTheme();
  const rows = Children.toArray(children).filter(Boolean);

  return (
    <View
      style={{
        backgroundColor: t.color.surface,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.color.border,
        overflow: "hidden",
      }}
    >
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 ? (
            // Inset from the left, so the divider reads as separating rows in a
            // list rather than slicing the card in two.
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                marginLeft: space.lg,
                backgroundColor: t.color.border,
              }}
            />
          ) : null}
          <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
            {row}
          </View>
        </View>
      ))}
    </View>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={{ ...type.heading, color: t.color.text, marginBottom: space.sm }}>
      {children}
    </Text>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ ...type.caption, color: t.color.textMuted }}>{children}</Text>;
}

/**
 * Empty states are load-bearing in this app: all three of them occur before the
 * user has any reason to trust it, so each offers an action rather than
 * announcing an absence (§3.5).
 */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ padding: space.xl, alignItems: "center", gap: space.sm }}>
      <Text style={{ ...type.heading, color: t.color.text, textAlign: "center" }}>
        {title}
      </Text>
      <Text
        style={{
          ...type.body,
          color: t.color.textMuted,
          textAlign: "center",
          maxWidth: 320,
        }}
      >
        {body}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={{
            marginTop: space.md,
            backgroundColor: t.color.accent,
            paddingHorizontal: space.xl,
            paddingVertical: space.md,
            borderRadius: radius.pill,
          }}
        >
          <Text style={{ ...type.label, color: "#fff" }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The sync banner carries staleness and the queued-write count in one line.
 * Someone offline for two days needs a way to tell whether anything is stuck; a
 * per-item indicator would be noise (§5.6).
 */
export function SyncBanner({ pending }: { pending: number }) {
  const t = useTheme();
  if (pending === 0) return null;
  return (
    <View
      style={{
        backgroundColor: t.color.accentSoft,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
      }}
    >
      <Text style={{ ...type.caption, color: t.color.accent }}>
        {pending} {pending === 1 ? "change" : "changes"} waiting to sync
      </Text>
    </View>
  );
}

export function AvatarStack({ names }: { names: readonly string[] }) {
  const t = useTheme();
  const shown = names.slice(0, 4);
  const extra = names.length - shown.length;

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((n, i) => (
        <View
          key={n}
          style={{
            width: 24,
            height: 24,
            borderRadius: radius.pill,
            backgroundColor: t.color.surfaceAlt,
            borderWidth: 2,
            borderColor: t.color.surface,
            alignItems: "center",
            justifyContent: "center",
            marginLeft: i === 0 ? 0 : -8,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "700", color: t.color.textMuted }}>
            {n.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      ))}
      {extra > 0 ? (
        <Text style={{ ...type.caption, color: t.color.textMuted, marginLeft: space.xs }}>
          +{extra}
        </Text>
      ) : null}
    </View>
  );
}
