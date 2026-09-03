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

console.log(`Fixtures set to ${now}.`);
console.log("Reload the app (press r in the Expo terminal) to rebuild them.");
