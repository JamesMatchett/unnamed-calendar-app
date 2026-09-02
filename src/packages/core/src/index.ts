/**
 * @uca/core — shared domain model.
 *
 * Imported by the Lambda handlers, the Expo app and the web app. Deliberately
 * free of AWS SDK, UI and I/O: the value is that the rules below exist exactly
 * once, and that the key shapes are never concatenated by hand.
 *
 * See Architecture.md §4.2 (keys), §4.3 (attributes), §5 (sync), §7–§8 (rules).
 */

export * from "./ids.js";
export * from "./time.js";
export * from "./keys.js";
export * from "./entities.js";
export * from "./membership.js";
export * from "./rsvp.js";
export * from "./sync.js";
