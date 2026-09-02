import { Linking, Platform } from "react-native";

/**
 * Opening a location in the device's map app.
 *
 * Coordinates are used when the location has them, because a name and address
 * are ambiguous — "The Crown" resolves to several hundred pubs — and a map that
 * drops you in the wrong city is worse than no map. The label still rides along
 * so the pin is named rather than anonymous.
 */
export interface MapTarget {
  readonly name?: string | null;
  readonly address?: string | null;
  readonly lat?: number | null;
  readonly lng?: number | null;
}

export function hasMapTarget(t: MapTarget): boolean {
  return Boolean(t.name || t.address || (t.lat != null && t.lng != null));
}

function buildUrl(t: MapTarget): string | null {
  const label = t.name ?? t.address ?? "";
  const query = [t.name, t.address].filter(Boolean).join(", ");
  const hasCoords = t.lat != null && t.lng != null;

  if (Platform.OS === "ios") {
    // Apple Maps. The q parameter names the pin; ll positions it.
    if (hasCoords) {
      return `maps://?ll=${t.lat},${t.lng}&q=${encodeURIComponent(label || "Location")}`;
    }
    return query ? `maps://?q=${encodeURIComponent(query)}` : null;
  }

  if (Platform.OS === "android") {
    // The geo: scheme lets the user's chosen map app handle it rather than
    // forcing Google Maps.
    if (hasCoords) {
      return `geo:${t.lat},${t.lng}?q=${t.lat},${t.lng}(${encodeURIComponent(label || "Location")})`;
    }
    return query ? `geo:0,0?q=${encodeURIComponent(query)}` : null;
  }

  // Web and anything else: a plain https URL always resolves.
  if (hasCoords) return `https://maps.google.com/?q=${t.lat},${t.lng}`;
  return query ? `https://maps.google.com/?q=${encodeURIComponent(query)}` : null;
}

/**
 * Falls back to a browser URL if no map app can handle the scheme — a simulator
 * without Maps installed, or an Android device with no mapping app at all.
 */
export async function openMap(target: MapTarget): Promise<void> {
  const url = buildUrl(target);
  if (!url) return;

  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // fall through to the web URL
  }

  const query = [target.name, target.address].filter(Boolean).join(", ");
  const web =
    target.lat != null && target.lng != null
      ? `https://maps.google.com/?q=${target.lat},${target.lng}`
      : `https://maps.google.com/?q=${encodeURIComponent(query)}`;

  await Linking.openURL(web).catch(() => undefined);
}
