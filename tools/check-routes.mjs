#!/usr/bin/env node
/**
 * `presentation` belongs to the layout, never to the screen.
 *
 * Written because of a bug that read as nonsense: toggling "Tickets needed" on
 * the edit-event screen opened a second copy of the same event, on top of the
 * first, with nothing changed.
 *
 * The toggle had nothing to do with it. `presentation` decides which container
 * the navigator builds around a screen, and it cannot be changed once that
 * screen is mounted. A screen that sets it from the inside therefore mounts as
 * a card and then asks to become a modal, and React Navigation obliges the only
 * way it can, by building the scene again. Any re-render could trigger it; the
 * toggle was simply where somebody happened to tap.
 *
 * The same mistake has a quieter symptom that had already been fixed once by
 * hand: a route the layout does not register keeps its file path as the header
 * title, which is why "calendar/[calendarId]/event/edit/[eve..." was written
 * across the top of the screenshot.
 *
 * Neither is visible in review, neither fails a typecheck, and both look like
 * correct code. So the rule is checked instead:
 *
 *   1. Only app/_layout.tsx may set `presentation`.
 *   2. Every route it registers must exist as a file.
 *
 * Titles are deliberately NOT covered. A title is an ordinary option, safe to
 * change after mount, and several screens rightly set one from their own data.
 */

import { globSync, readFileSync } from "node:fs";

const APP = "src/apps/mobile/app";
const LAYOUT = `${APP}/_layout.tsx`;

const files = globSync(`${APP}/**/*.tsx`).map((p) => p.replaceAll("\\", "/"));
if (files.length === 0) {
  console.error("check-routes found no screens, which means it is broken.");
  process.exit(1);
}

let bad = 0;

// --- 1. presentation only in the layout -------------------------------------

for (const file of files) {
  if (file.endsWith("/_layout.tsx")) continue;
  const text = readFileSync(file, "utf8");

  text.split("\n").forEach((line, i) => {
    // Only where it is being SET as an option, so prose mentioning the word is
    // left alone.
    if (!/presentation\s*:/.test(line)) return;
    console.error(
      `${file}:${i + 1}: sets presentation from inside the screen.\n` +
        `    Move it to app/_layout.tsx: presentation cannot change after a\n` +
        `    screen mounts, so setting it here makes the navigator build the\n` +
        `    scene a second time on top of the first.`,
    );
    bad += 1;
  });
}

// --- 2. every registered route exists ---------------------------------------

const layout = readFileSync(LAYOUT, "utf8");
const registered = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map(
  (m) => m[1],
);
// Also catches the multi-line form, where name sits on its own line.
for (const m of layout.matchAll(/\n\s*name="([^"]+)"/g)) registered.push(m[1]);

const known = new Set(
  files.map((f) => f.slice(APP.length + 1).replace(/\.tsx$/, "")),
);

for (const route of new Set(registered)) {
  // A group, "(tabs)", is a directory with its own layout rather than a screen.
  if (route.startsWith("(") && route.endsWith(")")) {
    if (!globSync(`${APP}/${route}/_layout.tsx`).length) {
      console.error(`${LAYOUT}: registers "${route}", which has no _layout.tsx`);
      bad += 1;
    }
    continue;
  }
  if (known.has(route) || known.has(`${route}/index`)) continue;
  console.error(
    `${LAYOUT}: registers "${route}", which is not a screen file.\n` +
      `    A misspelled route is registered silently and does nothing, so the\n` +
      `    screen keeps its file path as a title and whatever options it was\n` +
      `    meant to get.`,
  );
  bad += 1;
}

if (bad > 0) {
  console.error(`\n${bad} routing problem${bad === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(
  `ok: presentation is set only in the layout, across ${files.length} screens`,
);
