#!/usr/bin/env node
/**
 * Are the fixtures still about now?
 *
 * Runs before `expo start`. Fixture dates are relative to FIXTURE_EPOCH, the
 * moment they were last seeded, so a repository picked up after a few weeks
 * shows a trip that already happened and an agenda with nothing coming up,
 * and it looks like a bug rather than like old data. This says so at the one
 * moment somebody is looking at the terminal, and names the fix.
 *
 * A warning, never a failure: starting the app must not depend on it, and the
 * reseed is deliberately a choice, because rebuilding the fixtures also drops
 * every example row somebody may have been in the middle of testing against.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const STALE_AFTER_DAYS = 7;

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "db", "seed.ts"), "utf8");
const epoch = source.match(/^export const FIXTURE_EPOCH = "([^"]*)";$/m)?.[1];

if (epoch === undefined) {
  console.warn("check-fixtures: FIXTURE_EPOCH not found in src/db/seed.ts; nothing checked.");
  process.exit(0);
}

const days = Math.floor((Date.now() - Date.parse(epoch)) / 86_400_000);
if (days >= STALE_AFTER_DAYS) {
  console.warn(
    `\nThe example data was last seeded ${days} days ago (${epoch.slice(0, 10)}), so its ` +
      `events have drifted into the past.\nRun \`npm run reseed\` to bring them back around today, ` +
      `then reload the app.\n`,
  );
}
