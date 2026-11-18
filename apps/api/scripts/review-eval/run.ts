// Golden-set eval of the AI review: runs the synthetic briefs through the real model and compares the verdicts with
// the saved baseline. Calls the real LLM, so it runs by hand only, never in CI or `bun run check`:
//   bun run --cwd apps/api eval:review [--generator claude|openai] [--runs 3] [--only <id>,<id>] [--update-baseline]
// Bun loads the keys and the rest of the API config from .env.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { REVIEW_AREAS } from '@briefly/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { reviewGeneratorFrom } from '../../src/app';
import { ModelReview } from '../../src/briefs/domain/review';
import { REVIEW_EFFORT, REVIEW_MODEL } from '../../src/briefs/infra/claude-review-generator';
import { reviewRequest, SYSTEM } from '../../src/briefs/infra/review-prompt';
import { loadConfig } from '../../src/platform/config';
import { loadGolden } from './golden';
import { compare, formatBaseline, majority, scoreBrief, totals, type BriefResult, type RunOutcome } from './score';

const stop = (message: string, code = 2): never => {
  console.error(message);
  process.exit(code);
};

if (process.env.CI) stop('The golden-set eval calls the real model; it never runs in CI.');

const { values: args } = parseArgs({
  options: {
    generator: { type: 'string' },
    runs: { type: 'string', default: '3' },
    only: { type: 'string' },
    'update-baseline': { type: 'boolean', default: false },
  },
});
const runs = Number(args.runs);
if (!Number.isInteger(runs) || runs < 1) stop('--runs must be a positive whole number.');
if (args.generator !== undefined && args.generator !== 'claude' && args.generator !== 'openai') stop('--generator must be claude or openai.');
if (args['update-baseline'] && args.only) stop('--update-baseline needs the full set; drop --only.');

const config = (() => {
  try {
    return loadConfig({ ...process.env, ...(args.generator ? { REVIEW_GENERATOR: args.generator } : {}) });
  } catch (err) {
    return stop(err instanceof Error ? err.message : 'Invalid environment.');
  }
})();
if (config.REVIEW_GENERATOR === 'fake') stop('REVIEW_GENERATOR=fake returns a canned review; pick claude or openai.');

// The adapters log only metadata (model, usage, timing), never brief or model text; only warnings are shown.
const quiet = () => undefined;
const log = {
  info: quiet,
  debug: quiet,
  trace: quiet,
  warn: (_meta: unknown, msg?: string) => console.warn(`    warn: ${msg ?? ''}`),
  error: (_meta: unknown, msg?: string) => console.error(`    error: ${msg ?? ''}`),
  fatal: quiet,
  child: () => log,
} as unknown as FastifyBaseLogger;

const generate = reviewGeneratorFrom(config, log) ?? stop(`No API key for REVIEW_GENERATOR=${config.REVIEW_GENERATOR}.`);
const model = config.REVIEW_GENERATOR === 'openai' ? config.OPENAI_MODEL! : REVIEW_MODEL;

// Anything that changes what the model is asked: instructions, the user-turn template and the output schema.
const promptHash = createHash('sha256')
  .update(SYSTEM)
  .update(reviewRequest('T', 'B'))
  .update(JSON.stringify(z.toJSONSchema(ModelReview)))
  .digest('hex')
  .slice(0, 16);

const golden = loadGolden();
const only = args.only?.split(',').map((s) => s.trim());
const unknown = only?.filter((id) => !golden.some((g) => g.id === id)) ?? [];
if (unknown.length > 0) stop(`Unknown brief id: ${unknown.join(', ')}`);
const selected = only ? golden.filter((g) => only.includes(g.id)) : golden;

console.log(`Golden set: ${selected.length} briefs × ${runs} runs on ${config.REVIEW_GENERATOR} / ${model} (prompt ${promptHash})\n`);

const results: Record<string, BriefResult> = {};
const raw: Record<string, RunOutcome[]> = {};
for (const brief of selected) {
  const outcomes: RunOutcome[] = [];
  for (let i = 1; i <= runs; i++) {
    const started = performance.now();
    let result = await generate({ title: brief.title, body: brief.body });
    // One retry for transient failures (rate limits, overload, timeouts). A refusal isn't retried: refusing a
    // legitimate brief is a product bug, so it fails the run like any other failure that remains.
    if (!result.ok && result.error !== 'refused') result = await generate({ title: brief.title, body: brief.body });
    outcomes.push(result.ok ? { ok: true, review: result.review } : { ok: false, error: result.error });
    console.log(`  ${brief.id} ${i}/${runs} ${result.ok ? 'ok' : `FAILED (${result.error})`} ${((performance.now() - started) / 1000).toFixed(1)}s`);
  }
  raw[brief.id] = outcomes;
  results[brief.id] = scoreBrief(brief.expected, outcomes);
}

// The report: expected vs the majority answer per area, with how many runs got it right.
const short = { present: 'P', unclear: 'U', missing: 'M' } as const;
console.log(`\n${'brief'.padEnd(20)}${REVIEW_AREAS.map((a) => a.slice(0, 11).padEnd(13)).join('')}`);
for (const brief of selected) {
  const r = results[brief.id]!;
  const cells = REVIEW_AREAS.map((a) => {
    const got = majority(r.areas[a]);
    const cell = `${short[brief.expected.areas[a].status]}→${got ? short[got] : '-'} ${r.areas[a].right}/${r.areas[a].n}`;
    return (r.areas[a].right === r.areas[a].n ? cell : `${cell}*`).padEnd(13);
  });
  console.log(`${brief.id.padEnd(20)}${cells.join('')}`);
  for (const [name, c] of Object.entries(r.checks)) console.log(`${''.padEnd(20)}${c.passed === c.n ? 'ok  ' : 'FAIL'} ${name} (${c.passed}/${c.n})`);
}
const t = totals(results);
console.log(`\nscore ${t.score.toFixed(3)} · stability ${t.stability.toFixed(3)} · hard-miss areas ${t.hardMissAreas} · failed runs ${t.failedRuns}`);

// Raw answers are for a human to read; they stay out of the repo and out of stdout.
const outDir = mkdtempSync(join(tmpdir(), 'review-eval-'));
const outFile = join(outDir, 'outputs.json');
writeFileSync(outFile, JSON.stringify(raw, null, 2), { mode: 0o600 });
console.log(`raw outputs: ${outFile}`);

const baselineFile = join(import.meta.dirname, 'baselines', `${config.REVIEW_GENERATOR}-${model.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`);
type Baseline = { meta: Record<string, unknown> & { promptHash: string }; briefs: Record<string, BriefResult> };

if (t.failedRuns > 0) {
  const refused = Object.values(results).reduce((s, b) => s + b.failures.filter((e) => e === 'refused').length, 0);
  stop(`\n${refused} run(s) refused by the model, ${t.failedRuns - refused} failed after a retry; the numbers above are incomplete and nothing was compared or saved.`, 1);
}

if (args['update-baseline']) {
  const gitSha = execFileSync('git', ['describe', '--always', '--dirty']).toString().trim();
  const effort = config.REVIEW_GENERATOR === 'claude' ? REVIEW_EFFORT : 'default';
  const baseline: Baseline = { meta: { date: new Date().toISOString().slice(0, 10), gitSha, generator: config.REVIEW_GENERATOR, model, effort, runs, promptHash, ...t }, briefs: results };
  writeFileSync(baselineFile, formatBaseline(baseline.meta, baseline.briefs));
  console.log(`\nBaseline written: ${baselineFile}`);
  process.exit(0);
}

if (!existsSync(baselineFile)) {
  console.log(`\nNo baseline for ${config.REVIEW_GENERATOR} / ${model}; run with --update-baseline to save one.`);
  process.exit(0);
}
const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as Baseline;
// A hard miss is a majority of runs, so a different N changes what counts as one.
if (baseline.meta.runs !== runs) stop(`\nThe baseline used --runs ${String(baseline.meta.runs)}; compare with the same number.`);
if (baseline.meta.promptHash !== promptHash) console.warn(`\nwarn: the prompt changed since the baseline (${baseline.meta.promptHash} → ${promptHash})`);
const { failures, warnings } = compare(baseline.briefs, results);
for (const w of warnings) console.warn(`warn: ${w}`);
for (const f of failures) console.error(`REGRESSION: ${f}`);
console.log(failures.length === 0 ? '\nNo regression against the baseline.' : `\n${failures.length} regression(s) against the baseline.`);
process.exit(failures.length === 0 ? 0 : 1);
