#!/usr/bin/env node
/**
 * The infrastructure agrees with itself about its own names.
 *
 * Written after finding the same mistake three times in one directory. The
 * project prefix was renamed from "uca" to "calder" in the Terraform modules
 * and not in: the three tfvars files, the README, or — the expensive one — both
 * GitHub workflows, which build CI role ARNs by convention. Nothing catches
 * that. `terraform validate` sees valid HCL, `terraform plan` passes because
 * the plan role is assumed before Terraform starts, and the failure arrives as
 * "cannot assume arn:aws:iam::…:role/uca-dev-ci-plan" naming a role nobody has
 * ever created, in CI, on the first run after a successful apply.
 *
 * A name that appears in two files will eventually disagree. Where the second
 * copy could be removed it has been; where it cannot — a workflow cannot read a
 * Terraform variable, and an S3 backend block cannot take one — this holds the
 * copies in step instead.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const TF = "src/terraform";
const WORKFLOWS = ".github/workflows";

if (!existsSync(TF) || !existsSync(WORKFLOWS)) {
  console.error(`check-infra: ${TF} or ${WORKFLOWS} is missing, so it checked nothing.`);
  process.exit(1);
}

const read = (p) => readFileSync(p, "utf8");

/**
 * A file that should be there and is not.
 *
 * Every read below names a file this layout requires, so a missing one is a
 * finding rather than a crash: an environment directory added without all of
 * its files is exactly the mistake worth reporting by name.
 */
const readOrNull = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

/** `variable "x" { ... default = "y" }` — the default only. */
function tfDefault(file, name) {
  const block = read(file).match(
    new RegExp(`variable\\s+"${name}"\\s*\\{[^}]*?default\\s*=\\s*"([^"]*)"`, "s"),
  );
  return block?.[1] ?? null;
}

const PLACEHOLDER = /REPLACE_WITH/;
const envs = readdirSync(`${TF}/envs`);

// --- the project prefix, which is what actually broke ----------------------

const project = tfDefault(`${TF}/bootstrap/variables.tf`, "project");
if (!project) fail(`${TF}/bootstrap/variables.tf`, "no default for `project`");

for (const env of envs) {
  const got = tfDefault(`${TF}/envs/${env}/variables.tf`, "project");
  if (got !== project) {
    fail(`${TF}/envs/${env}/variables.tf`, `project is "${got}", bootstrap says "${project}"`);
  }
}

for (const wf of readdirSync(WORKFLOWS).filter((f) => f.startsWith("terraform-"))) {
  const text = read(`${WORKFLOWS}/${wf}`);
  const declared = text.match(/^\s*PROJECT:\s*(\S+)/m)?.[1];
  if (declared !== project) {
    fail(
      `${WORKFLOWS}/${wf}`,
      `PROJECT is "${declared}", Terraform says "${project}".\n` +
        `    The role ARNs in this workflow are built from it, so they would name ` +
        `a role\n    that does not exist.`,
    );
  }
}

// --- one region ------------------------------------------------------------

const region = tfDefault(`${TF}/bootstrap/variables.tf`, "region");
for (const env of envs) {
  const got = tfDefault(`${TF}/envs/${env}/variables.tf`, "region");
  if (got !== region) fail(`${TF}/envs/${env}/variables.tf`, `region "${got}" != "${region}"`);

  const backend = read(`${TF}/envs/${env}/backend.tf`).match(/region\s*=\s*"([^"]+)"/)?.[1];
  if (backend !== region) {
    fail(`${TF}/envs/${env}/backend.tf`, `backend region "${backend}" != "${region}"`);
  }
}
for (const wf of readdirSync(WORKFLOWS).filter((f) => f.startsWith("terraform-"))) {
  const got = read(`${WORKFLOWS}/${wf}`).match(/AWS_REGION:\s*(\S+)/)?.[1];
  if (got !== region) fail(`${WORKFLOWS}/${wf}`, `AWS_REGION "${got}" != "${region}"`);
}

// --- one Terraform version -------------------------------------------------
//
// State records the version that wrote it, and an older binary refuses to read
// a newer state. So a laptop one release ahead of CI applies successfully and
// locks CI out of the state it just wrote, with an error about a version rather
// than about the upgrade that caused it. Everything that applies has to agree.

const versions = new Map();
for (const wf of readdirSync(WORKFLOWS).filter((f) => f.startsWith("terraform-"))) {
  const got = read(`${WORKFLOWS}/${wf}`).match(/TF_VERSION:\s*"([^"]+)"/)?.[1];
  if (got) versions.set(`${WORKFLOWS}/${wf}`, got);
  else fail(`${WORKFLOWS}/${wf}`, "no TF_VERSION pinned");
}

const distinct = new Set(versions.values());
if (distinct.size > 1) {
  fail(
    WORKFLOWS,
    `workflows pin different Terraform versions: ${[...versions]
      .map(([f, v]) => `${f.split("/").pop()} ${v}`)
      .join(", ")}`,
  );
}

// Every required_version floor must be satisfied by what CI actually installs,
// or CI fails on a constraint the repository set for itself.
const pinned = [...distinct][0];
const asNumbers = (v) => v.split(".").map(Number);
const atLeast = (a, b) => {
  const [x, y] = [asNumbers(a), asNumbers(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return true;
};

if (pinned) {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".tf") ? [`${dir}/${e.name}`] : [],
    );
  for (const file of walk(TF)) {
    const floor = read(file).match(/required_version\s*=\s*">=\s*([0-9.]+)"/)?.[1];
    if (floor && !atLeast(pinned, floor)) {
      fail(file, `required_version >= ${floor}, but CI installs ${pinned}`);
    }
  }
}

// --- each environment is internally consistent -----------------------------

for (const env of envs) {
  const tfvars = readOrNull(`${TF}/envs/${env}/terraform.tfvars`);
  const backendFile = readOrNull(`${TF}/envs/${env}/backend.tf`);

  if (tfvars === null || backendFile === null) {
    fail(`${TF}/envs/${env}`, `missing ${tfvars === null ? "terraform.tfvars" : "backend.tf"}`);
    continue;
  }

  // A tfvars that names a different environment than its own directory would
  // create dev-named resources in the staging account, and the run would look
  // like it worked.
  const declared = tfvars.match(/environment\s*=\s*"([^"]+)"/)?.[1];
  if (declared !== env) {
    fail(`${TF}/envs/${env}/terraform.tfvars`, `environment is "${declared}", directory is "${env}"`);
  }

  const accountId = tfvars.match(/account_id\s*=\s*"([^"]+)"/)?.[1] ?? "";
  const bucket = backendFile.match(/bucket\s*=\s*"([^"]+)"/)?.[1] ?? "";

  const accountSet = !PLACEHOLDER.test(accountId);
  const bucketSet = !PLACEHOLDER.test(bucket);

  // Not set up yet is fine. Half set up is not: it fails at `terraform init`
  // with a message about a bucket rather than about the thing you forgot.
  if (accountSet !== bucketSet) {
    fail(
      `${TF}/envs/${env}`,
      accountSet
        ? "account_id is filled in but backend.tf still has its placeholder"
        : "backend.tf is filled in but terraform.tfvars still has its placeholder",
    );
    continue;
  }
  if (!accountSet) continue;

  if (!/^\d{12}$/.test(accountId)) {
    fail(`${TF}/envs/${env}/terraform.tfvars`, `account_id "${accountId}" is not 12 digits`);
  }

  // The one name that genuinely cannot be derived: an S3 backend block takes no
  // variables, so this literal has to match what bootstrap builds.
  const expected = `${project}-tfstate-${env}-${accountId}`;
  if (bucket !== expected) {
    fail(
      `${TF}/envs/${env}/backend.tf`,
      `bucket is "${bucket}", bootstrap creates "${expected}"`,
    );
  }
}

// --- the app's API hostnames match the ones Terraform creates ---------------
//
// app.config.ts carries a hostname per environment, in source, and it has to:
// the URL is compiled into the bundle, so a build cannot look it up. That makes
// it the fourth copy of a name Terraform already owns, and the same shape as
// every other drift this file exists to catch — except worse, because the
// symptom appears on somebody else's phone. A build shipped to TestFlight with
// a hostname nothing answers on cannot be fixed by an apply; it needs another
// build, and a review.
//
// Terraform's `api_domain` default per environment is the truth. This holds the
// app's map to it.

const CONFIG = "src/apps/mobile/app.config.ts";
const appConfig = readOrNull(CONFIG);

if (appConfig === null) {
  fail(CONFIG, "is missing, so the app's API hostnames were not checked");
} else {
  const block = appConfig.match(/const API_URL[^=]*=\s*\{([\s\S]*?)\}/);
  if (!block) {
    fail(CONFIG, "has no API_URL map, or it has been renamed");
  } else {
    const inApp = new Map(
      [...block[1].matchAll(/(\w+)\s*:\s*"https:\/\/([^"]+)"/g)].map((m) => [m[1], m[2]]),
    );

    for (const env of envs) {
      const declared = tfDefault(`${TF}/envs/${env}/variables.tf`, "api_domain");
      const used = inApp.get(env);

      if (declared === null) {
        fail(`${TF}/envs/${env}/variables.tf`, "has no api_domain default");
      } else if (used === undefined) {
        fail(CONFIG, `API_URL has no entry for ${env}, which Terraform serves at ${declared}`);
      } else if (used !== declared) {
        fail(CONFIG, `API_URL.${env} is ${used}; Terraform creates ${declared}`);
      }
    }

    for (const env of inApp.keys()) {
      if (!envs.includes(env)) {
        fail(CONFIG, `API_URL has an entry for ${env}, which is not an environment`);
      }
    }
  }
}

// --- formatting, if there is anything here that can judge it ---------------
//
// CI runs `terraform fmt -check -recursive`, so unformatted HCL fails the first
// pull request rather than the person who wrote it. Checking here as well moves
// that to before the push. `fmt` also parses, so it catches malformed HCL, which
// is as far as anything can get without reaching a provider registry.

function formatter() {
  for (const bin of ["terraform", "tofu"]) {
    try {
      execFileSync(bin, ["version"], { stdio: "ignore" });
      return bin;
    } catch {
      /* not installed */
    }
  }
  return null;
}

const fmt = formatter();
if (fmt) {
  try {
    execFileSync(fmt, ["fmt", "-check", "-recursive", TF], { stdio: "pipe" });
  } catch (err) {
    const listed = String(err.stdout ?? "").trim().split("\n").filter(Boolean);
    for (const file of listed) fail(file, `not \`${fmt} fmt\` clean`);
    if (listed.length === 0) fail(TF, `\`${fmt} fmt -check\` failed: ${err.message}`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`\n${problems.length} infrastructure naming problem${problems.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

const ready = envs.filter(
  (e) => !PLACEHOLDER.test(readOrNull(`${TF}/envs/${e}/terraform.tfvars`) ?? "REPLACE_WITH"),
);
console.log(
  `ok: infrastructure names agree (${project}, ${region}); ` +
    `${ready.length ? ready.join(", ") + " configured" : "no environment configured yet"}` +
    // Said out loud rather than passing quietly: a check that silently skipped
    // half its job reads exactly like one that ran.
    `${fmt ? `; ${fmt} fmt clean` : "; FORMATTING NOT CHECKED, no terraform or tofu on PATH"}`,
);
