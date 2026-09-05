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
 *   - every module.NAME.OUTPUT reads an output that module actually declares
 *   - no resource's count or for_each depends on a SENSITIVE variable
 *
 * That last one is a scar. `count = local.apple_ready ? 1 : 0`, where
 * apple_ready meant "the credentials are in this shell", read as a sensible way
 * to leave a provider unbuilt until it could be configured. What it actually
 * said was that an apply run WITHOUT the secret should destroy the provider —
 * and CI's apply passes TF_VAR_commit and nothing else, so every merge silently
 * deleted Sign in with Apple and served the app an empty list of sign-in
 * buttons. Existence is declared intent; a secret is what a thing is configured
 * with. Gate count on a bool and read the secret separately.
 *
 * The check resolves locals before looking, because the original went through
 * one, and it deliberately does NOT unwrap nonsensitive() — laundering a
 * secret's sensitivity to get a cleaner plan is how the first version was
 * written, and it is exactly the thing worth catching.
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
      found.set(name, {
        file,
        hasDefault: /^\s{2}default\s*=/m.test(body),
        sensitive: /^\s{2}sensitive\s*=\s*true/m.test(body),
      });
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

/** Outputs a directory declares, which is the surface a caller may read. */
function declaredOutputs(dir) {
  const found = new Set();
  for (const file of tfFiles(dir)) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const [, name] of src.matchAll(/^output\s+"([^"]+)"/gm)) found.add(name);
  }
  return found;
}

/** Every module.NAME.OUTPUT read in a directory, and where it was read. */
function moduleReads(dir) {
  const found = [];
  for (const file of tfFiles(dir)) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const [, name, output] of src.matchAll(
      /\bmodule\.([A-Za-z_][A-Za-z0-9_-]*)\.([A-Za-z_][A-Za-z0-9_-]*)/g,
    )) {
      found.push({ file, name, output });
    }
  }
  return found;
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

/**
 * `locals` assignments in a directory, as name -> raw expression.
 *
 * Enough to follow one hop from a count to a secret, which is all the shape
 * this catches needs. Values run to the next assignment at the same indent.
 */
function declaredLocals(dir) {
  const found = new Map();
  for (const file of tfFiles(dir)) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const [, body] of src.matchAll(/^locals\s*\{\n([\s\S]*?)^\}/gm)) {
      for (const [, name, value] of body.matchAll(
        /^ {2}([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*([\s\S]*?)(?=^ {2}[A-Za-z_][A-Za-z0-9_-]*\s*=|\s*$)/gm,
      )) {
        found.set(name, value);
      }
    }
  }
  return found;
}

/** An expression with local.X replaced by its definition, to a fixed depth. */
function expandLocals(expression, locals, depth = 4) {
  let out = expression;
  for (let i = 0; i < depth; i += 1) {
    const next = out.replace(
      /\blocal\.([A-Za-z_][A-Za-z0-9_-]*)/g,
      (whole, name) => locals.get(name) ?? whole,
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Every count/for_each expression in a directory, with where it was written. */
function existenceExpressions(dir) {
  const found = [];
  for (const file of tfFiles(dir)) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const [, keyword, expression] of src.matchAll(
      /^ {2}(count|for_each)\s*=\s*(.*)$/gm,
    )) {
      found.push({ file, keyword, expression });
    }
  }
  return found;
}

const problems = [];
const dirs = dirsUnder(ROOT);
const declaredBy = new Map(dirs.map((d) => [d, declaredVariables(d)]));
const outputsBy = new Map(dirs.map((d) => [d, declaredOutputs(d)]));

for (const dir of dirs) {
  const declared = declaredBy.get(dir);
  const where = (f) => relative(process.cwd(), f);
  const callsHere = new Map(moduleCalls(dir).map((c) => [c.name, c]));

  // Reading an output a module does not have is the mirror of passing an
  // argument it does not take, and it fails in the same place: at plan, in the
  // environment somebody happens to be planning, which for staging and prod is
  // not on any pull request.
  for (const { file, name, output } of moduleReads(dir)) {
    const call = callsHere.get(name);
    if (!call) {
      problems.push(`${where(file)}: reads module.${name}, which ${where(dir)} does not declare`);
      continue;
    }
    const outputs = outputsBy.get(call.dir);
    if (outputs && !outputs.has(output)) {
      problems.push(
        `${where(file)}: reads module.${name}.${output}, which ${where(call.dir)} does not output`,
      );
    }
  }

  const locals = declaredLocals(dir);
  for (const { file, keyword, expression } of existenceExpressions(dir)) {
    const expanded = expandLocals(expression, locals);
    for (const [, name] of expanded.matchAll(/\bvar\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      if (declared.get(name)?.sensitive === true) {
        problems.push(
          `${where(file)}: ${keyword} depends on var.${name}, which is sensitive — ` +
            "absence of a secret would destroy the resource; gate existence on a declared bool instead",
        );
      }
    }
  }

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
