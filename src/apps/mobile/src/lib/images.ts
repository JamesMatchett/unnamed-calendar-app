import type { ImageSourcePropType } from "react-native";

/**
 * Cover art.
 *
 * A cover is stored as a string that is either a bundled key ("lisbon") or a
 * file URI from the photo library ("file://..."). One column, two sources, and
 * the difference is resolved here rather than at every call site.
 *
 * The bundled images are generated abstract art rather than photographs. For
 * fixtures that is the honest choice: an obviously-illustrative cover cannot be
 * mistaken for a real photograph of a place, and there is no stock-library
 * licence hanging over the repository.
 */
const BUNDLED = {
  lisbon: require("../../assets/covers/lisbon.png"),
  tram: require("../../assets/covers/tram.png"),
  fado: require("../../assets/covers/fado.png"),
  beach: require("../../assets/covers/beach.png"),
  market: require("../../assets/covers/market.png"),
  london: require("../../assets/covers/london.png"),
  gig: require("../../assets/covers/gig.png"),
  football: require("../../assets/covers/football.png"),
  glastonbury: require("../../assets/covers/glastonbury.png"),
  roast: require("../../assets/covers/roast.png"),
} as const;

export type CoverKey = keyof typeof BUNDLED;

export function coverSource(
  value: string | null | undefined,
): ImageSourcePropType | null {
  if (!value) return null;
  if (value in BUNDLED) return BUNDLED[value as CoverKey];
  // Anything else is a URI the person chose from their library.
  return { uri: value };
}
