#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Match bash script behavior
const ROOT = path.resolve(__dirname, "..");
const TARGET_DIR = path.join(ROOT, "client", "src", "components");

// Same patterns as the .sh
const PATTERNS = [
  "addMinutes(",
  "addHours(",
  "addDays(",
  "addWeeks(",
  "addMonths(",
  "addYears(",
  "calculateNextOccurrences(",
  "getNthWeekdayOfMonth(",
];

// Same exclusions, expressed as ripgrep globs
const EXCLUDES = ["--glob=!calendar-view.tsx", "--glob=!google-tasks-recurrence.tsx"];

function runRg(args) {
  return spawnSync("rg", args, { cwd: ROOT, encoding: "utf8", shell: false });
}

let FAIL = 0;

for (const pat of PATTERNS) {
  // rg -l
  const listRes = runRg(["-l", pat, TARGET_DIR, ...EXCLUDES]);
  if (listRes.status === 2) {
    console.error("❌ rg error while scanning:");
    if (listRes.stderr) console.error(listRes.stderr.trimEnd());
    process.exit(2);
  }

  if (listRes.status === 0) {
    console.log(`❌ recurrence math found in components for pattern: ${pat}`);

    // rg -n for context
    const linesRes = runRg(["-n", pat, TARGET_DIR, ...EXCLUDES]);
    if (linesRes.stdout) process.stdout.write(linesRes.stdout);
    if (linesRes.stderr) process.stderr.write(linesRes.stderr);

    FAIL = 1;
  }
}

if (FAIL !== 0) {
  console.log("Guard failed: move recurrence math into lib/occurrence-engine.ts or recurrence-utils.ts");
  process.exit(1);
}

console.log("✅ no forbidden recurrence math in components");
process.exit(0);

