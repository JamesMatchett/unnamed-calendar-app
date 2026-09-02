/**
 * Design tokens. One place, so screens never hard-code a colour.
 *
 * Light and dark are both first-class: a calendar app is opened in a dark venue
 * as often as in daylight.
 */

import { useColorScheme } from "react-native";

const palette = {
  ink900: "#12141A",
  ink800: "#1B1E26",
  ink700: "#262A35",
  ink500: "#5A6072",
  ink300: "#9AA0B1",
  ink100: "#E3E6ED",
  ink50: "#F4F6FA",
  white: "#FFFFFF",

  // One accent, used sparingly — for the primary action on a screen and nothing
  // else, so "the coloured thing" always means "the thing to tap".
  accent: "#4C6FFF",
  accentSoft: "#EAEEFF",
  accentDark: "#8AA0FF",

  going: "#1F9D6B",
  maybe: "#C98A16",
  notGoing: "#B4485A",

  danger: "#C0455A",
} as const;

export interface Theme {
  readonly dark: boolean;
  readonly color: {
    readonly bg: string;
    readonly surface: string;
    readonly surfaceAlt: string;
    readonly border: string;
    readonly text: string;
    readonly textMuted: string;
    readonly accent: string;
    readonly accentSoft: string;
    readonly going: string;
    readonly maybe: string;
    readonly notGoing: string;
    readonly danger: string;
  };
}

const light: Theme = {
  dark: false,
  color: {
    bg: palette.ink50,
    surface: palette.white,
    surfaceAlt: palette.ink100,
    border: "#DFE3EC",
    text: palette.ink900,
    textMuted: palette.ink500,
    accent: palette.accent,
    accentSoft: palette.accentSoft,
    going: palette.going,
    maybe: palette.maybe,
    notGoing: palette.notGoing,
    danger: palette.danger,
  },
};

const dark: Theme = {
  dark: true,
  color: {
    bg: palette.ink900,
    surface: palette.ink800,
    surfaceAlt: palette.ink700,
    border: "#2E3341",
    text: "#F2F4F9",
    textMuted: palette.ink300,
    accent: palette.accentDark,
    accentSoft: "#232941",
    going: "#3FBF8B",
    maybe: "#E0A93A",
    notGoing: "#D9697B",
    danger: "#D9697B",
  },
};

export const useTheme = (): Theme =>
  useColorScheme() === "dark" ? dark : light;

/** 4pt grid. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 28, fontWeight: "700" },
  heading: { fontSize: 20, fontWeight: "700" },
  body: { fontSize: 16, fontWeight: "400" },
  label: { fontSize: 14, fontWeight: "600" },
  caption: { fontSize: 13, fontWeight: "400" },
} as const;
