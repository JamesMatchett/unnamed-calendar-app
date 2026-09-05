/**
 * Timezone choices for a calendar.
 *
 * A calendar's `defaultTz` decides what time an event means: a holiday in
 * Portugal should not silently schedule in UK time (§3.5, §5.5). So it is asked
 * for at creation rather than inferred and quietly wrong.
 */

/** A short list beats an exhaustive one when the answer is usually the device. */
const COMMON = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Athens",
  "Europe/Istanbul",
  "Atlantic/Canary",
  "Atlantic/Reykjavik",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Africa/Marrakesh",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
  } catch {
    return "Europe/London";
  }
}

/**
 * Every zone the runtime knows about where available, falling back to the
 * curated list. Hermes does not always ship `supportedValuesOf`, and a missing
 * function should not cost the user their timezone picker.
 */
export function allTimeZones(): string[] {
  const device = deviceTimeZone();
  let zones: string[] = [];

  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    if (typeof supported === "function") zones = supported("timeZone");
  } catch {
    zones = [];
  }

  const base = zones.length > 0 ? zones : COMMON;
  return [device, ...base.filter((z) => z !== device)];
}

export function searchTimeZones(query: string, limit = 40): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  const all = allTimeZones();
  if (q.length === 0) return all.slice(0, limit);
  return all.filter((z) => z.toLowerCase().includes(q)).slice(0, limit);
}

/** "Europe/Lisbon" reads better as "Lisbon · Europe". */
export function describeZone(tz: string): { city: string; region: string } {
  const parts = tz.split("/");
  const city = (parts[parts.length - 1] ?? tz).replace(/_/g, " ");
  const region = parts.length > 1 ? (parts[0] ?? "").replace(/_/g, " ") : "";
  return { city, region };
}

/** The current offset, so a choice can be sanity-checked at a glance. */
export function offsetLabel(tz: string): string {
  try {
    const s = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return s ?? "";
  } catch {
    return "";
  }
}
