import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  HANDLE_MAX,
  HANDLE_MIN,
  handleFault,
  normaliseHandle,
  suggestHandle,
} from "../dist/index.js";

test("a plain handle is left alone", () => {
  assert.equal(normaliseHandle("james"), "james");
  assert.equal(normaliseHandle("priya.k"), "priya.k");
  assert.equal(normaliseHandle("luke_s"), "luke_s");
});

test("the sigil people type is stripped, either of them", () => {
  assert.equal(normaliseHandle("&glenn"), "glenn");
  assert.equal(normaliseHandle("@glenn"), "glenn");
  assert.equal(normaliseHandle("&&glenn"), "glenn");
});

test("capitals and spaces are not part of a handle", () => {
  assert.equal(normaliseHandle("  James  "), "james");
  assert.equal(normaliseHandle("Sam Oneill"), "samoneill");
});

test("anything that would need escaping in a URL is dropped", () => {
  // The whole reason this is one shared rule: a handle goes into a path.
  assert.equal(normaliseHandle("a/b"), "ab");
  assert.equal(normaliseHandle("a?b=c"), "abc");
  assert.equal(normaliseHandle("a#b"), "ab");
  assert.equal(normaliseHandle("<script>"), "script");
  assert.equal(normaliseHandle("a%20b"), "a20b");
});

test("a handle is capped", () => {
  assert.equal(normaliseHandle("a".repeat(80)).length, HANDLE_MAX);
});

test("normalising twice is the same as normalising once", () => {
  // A handle is normalised on input, again when a link is built and again when
  // one is opened. If that were not stable, a round trip would change who you
  // are.
  for (const raw of ["&James", "a/b", "a".repeat(80), "  x  ", "@@@", "Zoë"]) {
    const once = normaliseHandle(raw);
    assert.equal(normaliseHandle(once), once, raw);
  }
});

test("a handle with nothing usable in it comes back empty", () => {
  // Empty is what the screens check for, so it has to be reachable.
  assert.equal(normaliseHandle("!!!"), "");
  assert.equal(normaliseHandle("&"), "");
  assert.equal(normaliseHandle(""), "");
});

test("a first name becomes a reasonable first guess", () => {
  assert.equal(suggestHandle("Maya Okonkwo"), "maya");
  assert.equal(suggestHandle("  Luke   Spray "), "luke");
  assert.equal(suggestHandle(""), "");
});

// --- why a handle cannot be used ---------------------------------------------

test("a good, free handle has no fault", () => {
  assert.equal(handleFault("james", false), null);
});

test("taken is a fault, and only when it is actually taken", () => {
  assert.equal(handleFault("james", true), "taken");
  assert.equal(handleFault("james", false), null);
});

test("too short is its own fault, not silence", () => {
  // The bug: onboarding greyed the button out for these and left the ordinary
  // hint underneath, so the button was dead with nothing saying why.
  assert.equal(handleFault("jo", false), "too_short");
  assert.equal(handleFault("a", false), "too_short");
  assert.equal(handleFault("a-b", false), "too_short", "normalises to two");
});

test("empty is distinguished from too short", () => {
  // They want different sentences: one is "you have not picked one yet", the
  // other is "the one you picked is not long enough".
  assert.equal(handleFault("", false), "empty");
  assert.equal(handleFault("&", false), "empty");
  assert.equal(handleFault("!!!", false), "empty");
});

test("length is judged after normalising, never before", () => {
  // "a-b-c" looks like five characters and is three.
  assert.equal(handleFault("a-b-c", false), null);
  assert.equal(handleFault("&&&jo", false), "too_short");
});

test("a handle at exactly the minimum is allowed", () => {
  assert.equal(normaliseHandle("abc").length, HANDLE_MIN);
  assert.equal(handleFault("abc", false), null);
});

test("being too short beats being taken", () => {
  // Only one sentence fits under the field, and the one to act on is the one
  // that is true regardless of who else exists.
  assert.equal(handleFault("jo", true), "too_short");
});

// --- the copy that cannot import this one -----------------------------------

test("the invite page's parser agrees with this one", () => {
  // site/add/index.html runs in a browser with no bundler, so it carries its
  // own copy of the rule. This reads that copy out of the page and runs it
  // against the same inputs, which is the nearest thing to sharing the code
  // that a static file allows. If somebody edits one and not the other, a QR
  // that scans on a phone with the app resolves to a different handle on a
  // phone without it, and nothing else would catch that.
  const html = readFileSync(
    new URL("../../../../site/add/index.html", import.meta.url),
    "utf8",
  );

  const start = html.indexOf("const segments =");
  const end = html.indexOf("const params =");
  assert.ok(start > 0 && end > start, "the parser has moved or been renamed");

  const source = html.slice(start, end);
  assert.ok(source.includes("slice(0, 24)"), "the cap has moved out of the parser");
  const webParse = new Function("location", `${source} return handle;`);

  const cases = [
    "james",
    "priya.k",
    "&glenn",
    "@glenn",
    "James",
    "a".repeat(80),
    "a.b_c",
    "!!!",
    "sam99",
  ];

  for (const raw of cases) {
    const mine = normaliseHandle(raw);
    // The page reads the last path segment, and the app builds that segment by
    // normalising first, so the comparison is against an already-clean value.
    const theirs = webParse({ pathname: `/add/${encodeURIComponent(mine)}` });
    assert.equal(theirs, mine, `disagreed on ${JSON.stringify(raw)}`);
  }
});

test("the invite page never puts a scanned name into markup", () => {
  // The name comes off a QR code a stranger made. textContent is the whole
  // defence, and innerHTML anywhere near it would undo it.
  const html = readFileSync(
    new URL("../../../../site/add/index.html", import.meta.url),
    "utf8",
  );
  const nameLines = html
    .split("\n")
    .filter((l) => l.includes("name") && l.includes("inner"));
  assert.deepEqual(nameLines, [], "the scanned name reaches innerHTML");
  assert.ok(html.includes('getElementById("name").textContent'));
});
