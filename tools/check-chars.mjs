#!/usr/bin/env node
/**
 * No invisible characters in source.
 *
 * Written because of a real bug that survived a review, a typecheck, 173 tests
 * and a commit. A string separator in syncHash was a NUL byte rather than the
 * space it appeared to be. SQLite treats NUL as the end of a string, so every
 * hash written to the database was silently cut down to the first field, no
 * stored hash ever matched a computed one, and the "don't rewrite what has not
 * changed" optimisation was dead on arrival while looking perfectly correct in
 * the diff.
 *
 * That is the whole argument for this check. A character you cannot see is one
 * you cannot review, and the failure it causes surfaces a long way from its
 * cause. The compiler has no opinion here: "\0" is a valid string.
 *
 * What counts as invisible: C0 control characters other than tab and newline,
 * a lone carriage return, zero-width and directional-override characters, and
 * non-breaking spaces, which look exactly like spaces and are not.
 */

import { globSync, readFileSync } from "node:fs";

// Filtered here rather than through glob's own exclude, whose argument differs
// between Node versions: this is a check that must not quietly scan nothing.
const IGNORED = ["node_modules", "/dist/", "/.expo/"];
const FILES = globSync([
  "src/**/*.{ts,tsx,mjs,js,json}",
  "tools/**/*.mjs",
  "*.{json,mjs}",
]).filter((p) => !IGNORED.some((skip) => p.replaceAll("\\", "/").includes(skip)));

if (FILES.length === 0) {
  console.error("check-chars found no files to scan, which means it is broken.");
  process.exit(1);
}

/** Each entry: [name, test]. Tab and newline are deliberately absent. */
const BANNED = [
  ["NUL", 0x00],
  ["backspace", 0x08],
  ["vertical tab", 0x0b],
  ["form feed", 0x0c],
  ["carriage return", 0x0d],
  ["escape", 0x1b],
  ["zero-width space", 0x200b],
  ["zero-width non-joiner", 0x200c],
  ["zero-width joiner", 0x200d],
  ["left-to-right override", 0x202d],
  ["right-to-left override", 0x202e],
  ["zero-width no-break space", 0xfeff],
  ["non-breaking space", 0x00a0],
];
const NAMES = new Map(BANNED.map(([name, code]) => [code, name]));
const CODES = new Set(BANNED.map(([, code]) => code));

let bad = 0;

for (const file of FILES) {
  const text = readFileSync(file, "utf8");
  let line = 1;
  let column = 1;

  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    if (CODES.has(code)) {
      const label = NAMES.get(code);
      const hex = code.toString(16).padStart(4, "0");
      console.error(`${file}:${line}:${column}: ${label} (U+${hex.toUpperCase()})`);
      bad += 1;
    }
    column += 1;
  }
}

if (bad > 0) {
  console.error(
    `\n${bad} invisible character${bad === 1 ? "" : "s"} in source. ` +
      `They are not what they look like: replace them with what you meant.`,
  );
  process.exit(1);
}

console.log(`ok: no invisible characters across ${FILES.length} files`);
