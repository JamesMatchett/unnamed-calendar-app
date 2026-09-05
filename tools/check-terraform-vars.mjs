#!/usr/bin/env node
/**
 * Terraform variables that are declared, passed and used consistently.
 *
 * `terraform validate` covers this, and CI runs it, but only after downloading
 * a provider — so it cannot run where there is no registry, and locally it is
 * the step people skip. More to the point, the failure this catches is not
 * loud: a module gains a required variable, one of three environments is
 * updated and the other two are not, and nothing says so until somebody
 * applies staging months later. dev is planned on every pull request; staging
 * and prod are not planned at all until an account exists for them.
 *
 * Checks, per directory:
 *   - every var.X referenced is declared in that directory
 *   - every argument passed to a module is a variable that module declares
 *   - every module variable without a default is passed by every caller
 *   - every key set in a .tfvars is declared in that directory
 *
 * The parsing is regular expressions rather than HCL, which is honest about
 * what it is: this repository's Terraform is small, formatted by `terraform
 * fmt`, and has no dynamic blocks. Comments are stripped first so that a
 * var.something mentioned in prose is not read as a reference.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2] ?? "src/terraform";

/** Meta-arguments every module call may carry that are not module variables. */
const META = new Set(["source", "count", "for_each", "providers", "depends_on", "version", "lifecycle"]);

function stripComments(src) {
  // Line comments only. Terraform's /* */ is legal but unused here, and
  // stripping it with a regex risks eating a legitimate string.
  return src
    .split("\n")
    .map((line) => line.replace(/(^|\s)(#|\/\/).*$/, "$1"))
    .join("\n");
}

function tfFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tf"))
    .map((f) => join(dir, f));
}

function dirsUnder(base) {
  const out = [];
  for (const name of readdirSync(base)) {
    const p = join(base, name);
    if (!statSync(p).isDirectory()) continue;
    if (name === ".terraform") continue;
    if (readdirSync(p).some((f) => f.endsWith(".tf"))) out.push(p);
    else out.push(...dirsUnder(p));
  }
  return out;
}

/** Variables a directory declares, and whether each has a default. */
function declaredVariables(dir) {
  const found = new Map();
  for (const file of tfFiles(dir)) {
    const src = stripComments(readFileSync(file, "utf8"));
    // Each top-level block runs to a closing brace in column zero, which holds
    // because everything here has been through `terraform fmt`.
    const blocks = src.matchAll(/^variable\s+"([^"]+)"\s*\{\n([\s\S]*?)^\}/gm);
    for (const [, name, body] of blocks) {
      found.set(name, { file, hasDefault: /^\s{2}default\s*=/m.test(body) });
    }
  }
  return found;
}

function referencedVariables(dir) {
  const found = new Map();
  for (const file of tfFiles(dir)) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const [, name] of src.matchAll(/\bvar\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      if (!found.has(name)) found.set(name, file);
    }
  }
  return found;
}

/** Module calls in a directory: the local source path and the arguments given. */
function moduleCalls(dir) {
  const calls = [];
  for (const file of tfFiles(dir)) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const [, name, body] of src.matchAll(/^module\s+"([^"]+)"\s*\{\n([\s\S]*?)^\}/gm)) {
      const source = body.match(/^\s{2}source\s*=\s*"([^"]+)"/m)?.[1];
      if (!source?.startsWith(".")) continue; // registry modules are not ours to check
      const args = new Set();
      for (const [, arg] of body.matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
        if (!META.has(arg)) args.add(arg);
      }
      calls.push({ file, name, dir: join(dir, source), args });
    }
  }
  return calls;
}

function tfvarsKeys(dir) {
  const found = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tfvars"))) {
    const src = stripComments(readFileSync(join(dir, file), "utf8"));
    for (const [, key] of src.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
      if (!found.has(key)) found.set(key, join(dir, file));
    }
  }
  return found;
}

const problems = [];
const dirs = dirsUnder(ROOT);
const declaredBy = new Map(dirs.map((d) => [d, declaredVariables(d)]));

for (const dir of dirs) {
  const declared = declaredBy.get(dir);
  const where = (f) => relative(process.cwd(), f);

  for (const [name, file] of referencedVariables(dir)) {
    if (!declared.has(name)) {
      problems.push(`${where(file)}: uses var.${name}, which nothing in ${where(dir)} declares`);
    }
  }

  for (const [key, file] of tfvarsKeys(dir)) {
    if (!declared.has(key)) {
      problems.push(`${where(file)}: sets ${key}, which is not a variable of ${where(dir)}`);
    }
  }

  for (const call of moduleCalls(dir)) {
    const target = declaredBy.get(call.dir);
    if (!target) {
      problems.push(`${where(call.file)}: module "${call.name}" points at ${where(call.dir)}, which has no .tf files`);
      continue;
    }
    for (const arg of call.args) {
      if (!target.has(arg)) {
        problems.push(`${where(call.file)}: module "${call.name}" passes ${arg}, which ${where(call.dir)} does not declare`);
      }
    }
    for (const [name, { hasDefault }] of target) {
      if (!hasDefault && !call.args.has(name)) {
        problems.push(`${where(call.file)}: module "${call.name}" omits ${name}, which ${where(call.dir)} requires`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`TERRAFORM VARIABLES (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
  for (const p of problems.sort()) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`terraform variables consistent across ${dirs.length} directories`);
