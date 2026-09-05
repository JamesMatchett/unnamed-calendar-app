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
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

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

let available = true;
try {
  execFileSync("actionlint", ["-version"], { stdio: "ignore" });
} catch {
  available = false;
}

if (!available) {
  console.log(
    `WORKFLOWS NOT CHECKED (${files.length} file${files.length === 1 ? "" : "s"}): ` +
      `actionlint is not installed. An invalid workflow is rejected by GitHub ` +
      `without running, so nothing downstream will catch it.`,
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

console.log(`ok: ${files.length} workflow files are valid`);
