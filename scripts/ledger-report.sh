#!/bin/bash
# Summarises the failure ledger that scripts/hooks/stop-check.sh writes: how often the check gates block, give up,
# recover or get abandoned, and on which step of `bun run check`. Run by hand; read it before proposing any change
# to the harness. Usage: scripts/ledger-report.sh [ledger file]
set -u
cd "$(dirname "$0")/.." || exit 1

main=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P) || exit 1
file=${1:-$main/.harness/failures.jsonl}
[ -s "$file" ] || { echo "No ledger entries yet ($file)."; exit 0; }

node -e '
const lines = require("node:fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
const events = lines.flatMap((l) => { try { const e = JSON.parse(l); return e && typeof e === "object" && typeof e.outcome === "string" ? [e] : []; } catch { return []; } });
const skipped = lines.length - events.length;
if (events.length === 0) { console.log(`No readable ledger entries (${skipped} unreadable lines).`); process.exit(0); }

// A run of blocks per session and gate ends in a give-up or a recovery; one with neither (the session ended,
// or the agent stopped trying) is "abandoned", counted under the step of its last block.
const open = new Map();
const rows = [];
for (const e of events) {
  const key = `${e.session}|${e.gate}|${e.treekey}`;
  if (e.outcome === "block") { open.set(key, e); rows.push(e); continue; }
  const last = open.get(key);
  open.delete(key);
  rows.push({ ...e, step: e.step ?? last?.step ?? "unknown" });
}
for (const e of open.values()) rows.push({ ...e, outcome: "abandoned" });

const outcomes = ["block", "recovered", "giveup", "abandoned"];
const table = new Map();
for (const r of rows) {
  const k = `${r.gate} ${r.step}`;
  const row = table.get(k) ?? Object.fromEntries(outcomes.map((o) => [o, 0]));
  row[r.outcome]++;
  table.set(k, row);
}

console.log(`${events.length} events, ${events[0].ts.slice(0, 10)} to ${events.at(-1).ts.slice(0, 10)}${skipped ? ` (${skipped} unreadable lines skipped)` : ""}\n`);
console.log(`${"gate step".padEnd(40)}${outcomes.map((o) => o.padStart(11)).join("")}`);
for (const [k, row] of [...table].sort((a, b) => b[1].block - a[1].block)) {
  console.log(`${k.padEnd(40)}${outcomes.map((o) => String(row[o]).padStart(11)).join("")}`);
}
const repeated = [...table].filter(([, row]) => row.giveup >= 2).map(([k]) => k);
console.log(`\nSteps with 2 or more give-ups: ${repeated.length ? repeated.join(", ") : "none"}`);
' "$file"
