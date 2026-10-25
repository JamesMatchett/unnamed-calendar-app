#!/usr/bin/env node
/**
 * Bring the fixtures forward to today.
 *
 * Fixture dates are written relative to the moment they were seeded, so a
 * simulator left alone for a fortnight shows a trip that has already happened
 * and an agenda with nothing coming up. This rewrites FIXTURE_EPOCH in seed.ts;
 * the app notices the change on its next reload, drops the fixture tables and
 * rebuilds them starting from now.
 *
 * It edits a source file rather than reaching into the simulator's database,
 * because the database lives somewhere different on every machine and platform,
 * and Metro is already watching this file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seedFile = join(here, "..", "src", "db", "seed.ts");

const source = readFileSync(seedFile, "utf8");
const pattern = /^export const FIXTURE_EPOCH = "[^"]*";$/m;

if (!pattern.test(source)) {
  console.error(
    "Could not find FIXTURE_EPOCH in src/db/seed.ts. Has it been renamed?",
  );
  process.exit(1);
}

const now = new Date().toISOString();
writeFileSync(
  seedFile,
  source.replace(pattern, `export const FIXTURE_EPOCH = "${now}";`),
);

// Say what the rebuilt fixtures will cover, so a set that has drifted to one
// side of today is visible here rather than on the agenda. Offsets are read
// out of the seed's own day()/isoDate() calls; a fixture written any other way
// is not counted, which is a reason to write them that way.
const offsets = [
  ...[...source.matchAll(/\b(?:day|isoDate)\(\s*(-?\d+)/g)].map((m) => Number(m[1])),
  // seedThisWeek's plan: one tuple per event, offset first, hour second.
  ...[...source.matchAll(/^\s*\[(-?\d+),\s*\d+,\s*"/gm)].map((m) => Number(m[1])),
];
const before = offsets.filter((n) => n < 0).length;
const today = offsets.filter((n) => n === 0).length;
const after = offsets.filter((n) => n > 0).length;
const span = offsets.length ? `${Math.min(...offsets)} to +${Math.max(...offsets)} days` : "none";

console.log(`Fixtures set to ${now}.`);
console.log(`They will land ${span} from today: ${before} before, ${today} on the day, ${after} after.`);
if (before === 0 || after === 0) {
  console.warn("WARNING: the fixtures no longer sit on both sides of today. See seedThisWeek in seed.ts.");
}
console.log("Reload the app (press r in the Expo terminal) to rebuild them.");
