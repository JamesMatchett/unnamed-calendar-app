// expo-sqlite's withTransactionSync is BEGIN/COMMIT, not a savepoint. A repo
// function that opens a transaction and then calls another repo function that
// also opens one commits the outer transaction early, and the outer COMMIT then
// fails with "cannot rollback - no transaction is active". This happened once
// (setIdentity -> updateProfile) and was only found on a device. It is a
// static property of the source, so it is checked statically.
//
// Run: node tools/check-transactions.mjs   (exit 1 on any nesting)

import { readFileSync } from "node:fs";

const path = new URL("../src/apps/mobile/src/db/repo.ts", import.meta.url);
const src = readFileSync(path, "utf8");

// Functions that open a transaction anywhere in their body.
const fnRe = /export function (\w+)\(/g;
const starts = [...src.matchAll(fnRe)].map((m) => ({ name: m[1], at: m.index }));
const bodyOf = (i) => src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
const transactional = new Set(
  starts.map((s, i) => [s.name, bodyOf(i)]).filter(([, b]) => b.includes("withTransactionSync(")).map(([n]) => n),
);

let bad = 0;
for (const m of src.matchAll(/withTransactionSync\(\(\) => \{/g)) {
  let i = m.index + m[0].length;
  let depth = 1;
  while (depth && i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  const block = src.slice(m.index, i);
  const outer = starts.filter((s) => s.at < m.index).at(-1)?.name ?? "?";
  for (const call of new Set([...block.matchAll(/\b(\w+)\(/g)].map((c) => c[1]))) {
    if (transactional.has(call) && call !== outer) {
      console.error(`nested transaction: ${outer} calls ${call} inside withTransactionSync`);
      bad++;
    }
  }
}

if (bad) process.exit(1);
console.log(`ok: no nested transactions across ${transactional.size} transactional functions`);
