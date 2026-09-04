import type { ImageSourcePropType } from "react-native";

/**
 * Cover art.
 *
 * A cover is stored as a string that is either a bundled key ("lisbon") or a
 * file URI from the photo library ("file://..."). One column, two sources, and
 * the difference is resolved here rather than at every call site.
 *
 * The bundled images are drawn rather than photographed, by tools/covers.py.
 * That is the honest choice for fixtures: an illustration cannot be mistaken
 * for a real photograph of a real place, and there is no stock-library licence
 * hanging over the repository. They do depict their subject, though - a hill of
 * terracotta roofs, a pitch under floodlights, tents on a hillside - because
 * the abstract gradients they replaced read as an image that had failed to
 * load rather than as a cover.
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
