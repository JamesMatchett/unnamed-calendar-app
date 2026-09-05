#!/usr/bin/env node
/**
 * The workflow files are valid GitHub Actions.
 *
 * This is the one class of mistake CI cannot catch for you. An invalid workflow
 * is not a failing run — GitHub refuses to run the file at all and posts an
 * annotation instead, so there is no job, no log, and nothing to read but a
 * line and column number. Every other check in this repository runs somewhere;
 * this one has to run BEFORE the push or it does not run.
 *
 * Written after shipping exactly that. A job-level `if` was given
 * `vars[matrix.account_var]`, which reads perfectly and is not allowed: the
 * matrix is expanded after that condition is evaluated, so `matrix` is not in
 * scope there. The workflow was rejected whole, on a pull request opened to
 * prove the infrastructure worked.
 *
 * actionlint knows the context rules per key, which is precisely the knowledge
 * that was missing. It is not usually installed, so this says plainly when it
 * could not check rather than passing quietly:
 *
 *   brew install actionlint     (or: go install github.com/rhysd/actionlint/cmd/actionlint@latest)
 *
 * It also checks, without needing anything installed, that every third-party
 * action is pinned to a commit SHA rather than a tag. A tag is a mutable
 * pointer in somebody else's repository, and these workflows assume an AWS role
 * — a moved tag runs that stranger's code against this account. The plan role
 * is assumable from any pull request, including the ones Dependabot opens to
 * propose new versions of these very actions, which is the loop worth breaking.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const DIR = ".github/workflows";

if (!existsSync(DIR)) {
  console.error(`check-workflows: ${DIR} is missing, so it checked nothing.`);
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
if (files.length === 0) {
  console.error(`check-workflows: no workflows in ${DIR}, so it checked nothing.`);
  process.exit(1);
}

// --- every action pinned to a commit ---------------------------------------

// Pure text, so this runs everywhere and always, unlike the actionlint pass
// below. A pin is 40 hex characters; anything else is a tag or a branch.
const unpinned = [];
const pinned = [];
for (const file of files) {
  const lines = readFileSync(`${DIR}/${file}`, "utf8").split("\n");
  lines.forEach((text, i) => {
    const match = /^\s*(?:-\s*)?uses:\s*(\S+)(?:\s*#\s*(\S+))?/.exec(text);
    if (!match) return;
    const [, ref, comment] = match;
    // A local action, ./path, is this repository and needs no pin.
    if (ref.startsWith("./")) return;
    const at = ref.lastIndexOf("@");
    const sha = at === -1 ? "" : ref.slice(at + 1);
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      unpinned.push(`${DIR}/${file}:${i + 1}: ${ref}`);
      return;
    }
    pinned.push({ file, line: i + 1, repo: ref.slice(0, at), sha, version: comment ?? "" });
  });
}

// A 40-character hex string is not necessarily a commit. An ANNOTATED tag's ref
// is the tag OBJECT, the same shape and the wrong value, and Actions cannot
// resolve it — the workflow fails at "unable to resolve action". Shape alone
// cannot tell the two apart, so this asks the upstream repository.
//
// It also catches a pin whose trailing version comment has drifted from the SHA
// beside it, which matters more than it sounds: once pins are SHAs, that comment
// is the only human-readable record of what is running.
//
// Network. When there is none it says so and passes, like the actionlint pass
// below and the fmt check in check-infra: a check that cannot run should say
// which, not fail the build or pass quietly.
function resolveUpstream(repo, version) {
  const out = execFileSync(
    "git",
    ["ls-remote", `https://github.com/${repo}`, version, `${version}^{}`],
    { encoding: "utf8", timeout: 8000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
  );
  const refs = new Map();
  for (const line of out.trim().split("\n").filter(Boolean)) {
    const [sha, ref] = line.split(/\s+/);
    refs.set(ref, sha);
  }
  const ref = refs.get(`refs/tags/${version}`) ?? null;
  // The peeled ref is the commit an annotated tag points at. Its absence means
  // the tag is lightweight and the ref already names a commit.
  const peeled = refs.get(`refs/tags/${version}^{}`) ?? null;
  return ref === null && peeled === null ? null : { commit: peeled ?? ref, tagObject: ref };
}

// One lookup per distinct repo and version, run together rather than in turn.
// Serially, five repositories at a 20-second timeout each is a check that can
// sit silent for a minute and a half with nothing on screen, which is
// indistinguishable from a hang — and this file exists to save time, not spend
// it.
const distinct = new Map();
for (const pin of pinned) {
  if (pin.version) distinct.set(`${pin.repo}@${pin.version}`, pin);
}

const resolved = new Map();
let resolvable = true;

await Promise.all(
  [...distinct.values()].map(async ({ repo, version }) => {
    try {
      resolved.set(`${repo}@${version}`, resolveUpstream(repo, version));
    } catch {
      resolvable = false;
    }
  }),
);

const wrong = [];
for (const { file, line, repo, sha, version } of pinned) {
  if (!version || !resolvable) continue; // nothing to check it against
  const upstream = resolved.get(`${repo}@${version}`);
  if (upstream === null) {
    wrong.push(`${DIR}/${file}:${line}: ${repo} has no tag ${version}`);
  } else if (upstream.commit !== sha) {
    // Two different mistakes with one symptom. Say which, because "it does not
    // match" sends you looking for a typo when the SHA may be exactly what the
    // tag resolves to and simply not be a commit.
    const why =
      sha === upstream.tagObject
        ? " (that is the annotated tag's object, not the commit it points at)"
        : "";
    wrong.push(`${DIR}/${file}:${line}: ${repo} ${version} is ${upstream.commit}, not ${sha}${why}`);
  }
}

if (wrong.length > 0) {
  console.error(`PINS DO NOT MATCH THEIR VERSIONS (${wrong.length}):`);
  for (const w of wrong) console.error(`  ${w}`);
  process.exit(1);
}

if (unpinned.length > 0) {
  console.error(
    `UNPINNED ACTIONS (${unpinned.length}). A tag can be moved by whoever owns it, ` +
      `and these jobs assume an AWS role:`,
  );
  for (const u of unpinned) console.error(`  ${u}`);
  console.error(
    "\nUse the commit SHA with the version in a trailing comment. For an ANNOTATED\n" +
      "tag the ref is the tag object, not the commit, and Actions cannot resolve it:\n" +
      "  git ls-remote https://github.com/OWNER/REPO 'vX.Y.Z^{}'",
  );
  process.exit(1);
}

let available = true;
try {
  execFileSync("actionlint", ["-version"], { stdio: "ignore" });
} catch {
  available = false;
}

if (!available) {
  console.log(
    `${pinned.length} actions pinned${resolvable ? " and matching their versions" : ""}; ` +
      `${resolvable ? "" : "PINS NOT RESOLVED against upstream, no network. "}` +
      `VALIDITY NOT CHECKED: actionlint is not installed. An invalid workflow is ` +
      `rejected by GitHub without running, so nothing downstream will catch it.`,
  );
  process.exit(0);
}

try {
  execFileSync("actionlint", ["-no-color", ...files.map((f) => `${DIR}/${f}`)], {
    stdio: "inherit",
  });
} catch {
  console.error("\nInvalid workflow. GitHub would reject the file rather than run it.");
  process.exit(1);
}

console.log(
  `ok: ${files.length} workflow files are valid; ${pinned.length} actions pinned to a commit` +
    (resolvable ? " that matches the version beside it" : ", PINS NOT RESOLVED upstream (no network)"),
);
