/**
 * Design tokens. One place, so screens never hard-code a colour.
 *
 * Light and dark are both first-class: a calendar app is opened in a dark venue
 * as often as in daylight.
 */

import { createContext, useContext } from "react";
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
  // A second green, darker than `going`, because these two are read in
  // different places. `going` is a chip on a surface at chip size; this is
  // caption text on the page background, where #1F9D6B manages 3.19:1 and is
  // not readable enough for something small that carries an answer.
  success: "#0F7A52",
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
    /**
     * The accent as a BACKGROUND, with the colour to write on it.
     *
     * Two roles that a single token cannot serve: on a dark screen the accent
     * has to lighten to stay legible as text, and a lightened blue with white
     * on top is a button nobody can read. So the fill keeps its saturation in
     * both themes and names what goes on it.
     */
    readonly accentFill: string;
    readonly onAccent: string;
    readonly going: string;
    /**
     * "Yes, that worked." Its own token rather than borrowing `going`: one is
     * an answer to an invitation, the other is a field accepting what you
     * typed, and a colour that means two things stops meaning either.
     */
    readonly success: string;
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
    accentFill: palette.accent,
    onAccent: palette.white,
    going: palette.going,
    success: palette.success,
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
    accentFill: "#3F58D6",
    onAccent: "#FFFFFF",
    going: "#3FBF8B",
    // Lighter than the light theme's, not darker: on ink900 this reads at
    // 7.92:1 where the light-mode green would nearly vanish.
    success: "#3FBF8B",
    maybe: "#E0A93A",
    notGoing: "#D9697B",
    danger: "#D9697B",
  },
};

/**
 * What the person chose. "system" is the default and follows the phone, which
 * is what most people want and the only option that keeps working when they
 * change their mind at the OS level; the other two are for the people for whom
 * it does not — a dark app in a bright kitchen, a light one in a dark venue.
 */
export type Appearance = "system" | "light" | "dark";

export const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match phone" },
];

export const themeFor = (
  appearance: Appearance,
  systemDark: boolean,
): Theme => {
  if (appearance === "dark") return dark;
  if (appearance === "light") return light;
  return systemDark ? dark : light;
};

/**
 * The resolved theme, provided once at the root.
 *
 * A context rather than each component reading the preference itself: the
 * choice lives in SQLite, and having several hundred components subscribe to
 * the database to learn what colour text is would be a lot of machinery for one
 * value that changes twice a year.
 */
const ThemeContext = createContext<Theme | null>(null);
export const ThemeProvider = ThemeContext.Provider;

export const useTheme = (): Theme => {
  const provided = useContext(ThemeContext);
  // The fallback matters: it is what draws the frames before the root layout
  // has mounted, and it is what a screenshot test or a stray render outside the
  // provider gets. Following the phone is the safest thing to be wrong with.
  const system = useColorScheme();
  return provided ?? (system === "dark" ? dark : light);
};

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
