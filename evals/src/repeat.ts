/**
 * Run the same eval pattern N times to measure stability (LLM evals are probabilistic — one
 * green run proves little). Wraps `vitest run`, so vitest flags (-t, path patterns) pass through;
 * only -n/--times and --label are consumed here. Aggregates the records written during the runs
 * into per-test pass rate, a per-practice breakdown, and metric stats (mean ± stddev).
 *
 *   pnpm eval:repeat skills/onion-architecture -n 5 --label baseline
 *
 * --label saves the aggregate to results/repeat-<label>.json so two labeled series can be diffed
 * with `pnpm eval:delta baseline candidate`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GREEN, RED, DIM, RESET, rateColor } from "./ansi.js";
import { gitInfo } from "./git.js";
import { countTests, runVitestOnce } from "./run-vitest.js";
import { RESULTS_DIR } from "./artifacts/paths.js";
import { aggregate, loadRecords, recordCount, type NodeAggregate, type Stats } from "./records/stats.js";

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const statLine = (label: string, s: Stats) =>
  `      ${label}: ${s.mean.toFixed(0)} ± ${s.stddev.toFixed(0)} [${s.min}–${s.max}]`;

function printTest(agg: NodeAggregate, times: number): void {
  const shortId = agg.nodeid.split(" > ").slice(-1)[0];
  console.log(`\n  ${rateColor(agg.pass.rate)}${agg.pass.passed}/${agg.pass.total} ${pct(agg.pass.rate)}${RESET}  ${shortId}`);
  const practices = Object.entries(agg.practices);
  if (practices.length) {
    for (const [text, s] of practices) {
      console.log(`      ${rateColor(s.rate)}${s.passed}/${s.total} ${pct(s.rate).padStart(4)}${RESET}  ${text}`);
    }
  }
  console.log(statLine("turns   ", agg.metrics.numTurns));
  console.log(statLine("duration", agg.metrics.durationMs));
  console.log(statLine("tok_out ", agg.metrics.outputTokens));
  if (times < 5) console.log(`      ${DIM}(n=${times}: stddev indicative only)${RESET}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let times = 5;
  let label: string | undefined;
  const vitestArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-n" || a === "--times") times = Number(argv[++i]);
    else if (a === "--label") label = argv[++i];
    else vitestArgs.push(a);
  }
  if (vitestArgs.length === 0 || !Number.isFinite(times) || times < 1) {
    console.error("usage: pnpm eval:repeat <vitest pattern> [-n times] [-t testNamePattern] [--label name]");
    process.exit(1);
  }

  const startLine = recordCount();
  let line = startLine;
  const nCases = countTests(vitestArgs);
  console.log(`\nRepeat: ${vitestArgs.join(" ")}`);
  console.log(`  ${nCases ?? "?"} test case(s) × ${times} runs  (full traces in results/outputs/)\n`);
  for (let i = 1; i <= times; i++) {
    const captured = await runVitestOnce(`run ${i}/${times}`, vitestArgs);
    const fresh = loadRecords(line);
    line = recordCount();
    if (fresh.length === 0) {
      console.log(`  run ${i}/${times}  ${RED}no records — run crashed${RESET}`);
      if (captured) console.log(captured.split("\n").slice(-6).join("\n"));
      continue;
    }
    const passed = fresh.filter((r) => r.outcome).length;
    const mark = passed === fresh.length ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  run ${i}/${times}  ${mark} ${passed}/${fresh.length} cases`);
  }

  const records = loadRecords(startLine);
  const tests = aggregate(records);
  const nodeids = Object.keys(tests).sort();

  console.log(`\n${"=".repeat(60)}\nRepeat summary (${times} runs)\n${"=".repeat(60)}`);
  if (nodeids.length === 0) {
    console.log("  (no records produced — check the pattern / -t filter)");
  }
  for (const id of nodeids) printTest(tests[id], times);

  if (label) {
    const git = gitInfo();
    mkdirSync(RESULTS_DIR, { recursive: true });
    const file = join(RESULTS_DIR, `repeat-${label}.json`);
    writeFileSync(file, JSON.stringify({ label, git_sha: git.sha, dirty: git.dirty, times, vitestArgs, tests }, null, 2));
    console.log(`\n${GREEN}Saved as '${label}'${RESET} -> ${file}`);
    console.log(`Compare with: pnpm eval:delta <baseline-label> ${label}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
