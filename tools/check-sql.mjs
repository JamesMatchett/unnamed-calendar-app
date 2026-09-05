/**
 * Do the SQL statements in repo.ts bind what they say they bind?
 *
 * Two mistakes this catches, both of which have actually happened:
 *
 *   1. More parameters than placeholders. createCalendar named sixteen columns
 *      and passed eighteen values, because is_private and cover_image were left
 *      out of the list. SQLite binds by position, so created_by silently took
 *      the privacy flag and created_at took the cover image: a crash when there
 *      was no cover, and wrong data written without complaint when there was.
 *
 *   2. A column list whose length does not match its VALUES list, which is the
 *      same bug caught one step earlier.
 *
 * Neither is a type error and neither shows up until the statement runs, which
 * for half the writes in this app means on somebody's phone. It is a static
 * property of the source, so it is checked statically.
 *
 * Run: node tools/check-sql.mjs   (exit 1 on any mismatch)
 */

import { readFileSync } from "node:fs";

const path = new URL("../src/apps/mobile/src/db/repo.ts", import.meta.url);
const src = withoutComments(readFileSync(path, "utf8"));

/**
 * Comments blanked out, keeping every offset and newline.
 *
 * Without this the parser reads the first argument of a call as whatever comes
 * after the open bracket, and a comment sitting above the SQL made it skip the
 * statement entirely. That is how the first version of this check passed on the
 * very bug it was written to catch.
 */
function withoutComments(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close < 0 ? text.length : close + 2;
      for (; i < end; i++) out += text[i] === "\n" ? "\n" : " ";
      i--;
      continue;
    }
    out += c;
  }
  return out;
}

let problems = 0;
const report = (line, message) => {
  console.error(`repo.ts:${line}  ${message}`);
  problems++;
};

const lineOf = (index) => src.slice(0, index).split("\n").length;

/** Placeholders that are actually placeholders, not question marks in a string. */
function countPlaceholders(sql) {
  let count = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "?") {
      count++;
    }
  }
  return count;
}

/**
 * Top-level items in an array or parenthesised list, ignoring nesting.
 *
 * The trailing comma the formatter leaves on multi-line arrays is not an item,
 * and counting it made every single statement look one parameter over.
 */
function countItems(raw) {
  const text = raw.trim().replace(/,\s*$/, "");
  let depth = 0;
  let quote = null;
  let items = text.trim().length === 0 ? 0 : 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) items++;
  }
  return items;
}

/** The matching close for the bracket at `open`. */
function matchBracket(text, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const close = pairs[text[open]];
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === text[open]) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

// --- 1. columns against VALUES ------------------------------------------------

for (const m of src.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)\s*\(/gi)) {
  const columnsOpen = m.index + m[0].length - 1;
  const columnsClose = matchBracket(src, columnsOpen);
  if (columnsClose < 0) continue;

  const rest = src.slice(columnsClose);
  const values = rest.match(/^\s*\)?\s*VALUES\s*\(/i);
  if (!values) continue; // INSERT ... SELECT, which has no VALUES list.

  const valuesOpen = columnsClose + values[0].length - 1;
  const valuesClose = matchBracket(src, valuesOpen);
  if (valuesClose < 0) continue;

  const columns = countItems(src.slice(columnsOpen + 1, columnsClose));
  const slots = countItems(src.slice(valuesOpen + 1, valuesClose));
  if (columns !== slots) {
    report(
      lineOf(m.index),
      `INSERT INTO ${m[1]} names ${columns} columns but supplies ${slots} values`,
    );
  }
}

// --- 2. placeholders against the parameter array -------------------------------

for (const m of src.matchAll(/\.(?:runSync|getFirstSync|getAllSync)\s*(?:<[^>]*>)?\s*\(/g)) {
  const callOpen = m.index + m[0].length - 1;
  const callClose = matchBracket(src, callOpen);
  if (callClose < 0) continue;

  const args = src.slice(callOpen + 1, callClose);
  // The SQL is the first argument, as a template literal or a plain string.
  const quote = args.trimStart()[0];
  if (quote !== "`" && quote !== '"' && quote !== "'") continue;
  const start = args.indexOf(quote);
  let end = -1;
  for (let i = start + 1; i < args.length; i++) {
    if (args[i] === quote && args[i - 1] !== "\\") {
      end = i;
      break;
    }
  }
  if (end < 0) continue;

  const sql = args.slice(start + 1, end);
  // An interpolated column list means the count is not knowable statically.
  if (sql.includes("${")) continue;

  const placeholders = countPlaceholders(sql);
  const after = args.slice(end + 1).trimStart();
  if (!after.startsWith(",")) {
    if (placeholders > 0) {
      report(lineOf(m.index), `a statement with ${placeholders} placeholders binds nothing`);
    }
    continue;
  }

  const arrayStart = after.indexOf("[");
  if (arrayStart < 0) continue; // Parameters come from a variable, not a literal.
  const arrayText = after.slice(arrayStart);
  const arrayEnd = matchBracket(arrayText, 0);
  if (arrayEnd < 0) continue;

  const params = countItems(arrayText.slice(1, arrayEnd));
  if (params !== placeholders) {
    report(
      lineOf(m.index),
      `${placeholders} placeholders but ${params} parameters`,
    );
  }
}

if (problems) {
  console.error(`\n${problems} statement${problems === 1 ? "" : "s"} would bind the wrong values.`);
  process.exit(1);
}
console.log("ok: every statement binds what it names");
