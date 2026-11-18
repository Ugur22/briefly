// The golden-set scoring rule: deterministic, so the same model answers always give the same score.
import { REVIEW_AREAS, type AreaStatus, type ReviewArea } from '@briefly/contracts';
import type { ModelReview } from '../../src/briefs/domain/review';
import type { Expected } from './golden';

export type RunOutcome = { ok: true; review: ModelReview } | { ok: false; error: string };

export type AreaResult = { counts: Record<AreaStatus, number>; right: number; n: number; hardMisses: number };
export type CheckResult = { passed: number; n: number };
export type BriefResult = {
  areas: Record<ReviewArea, AreaResult>;
  checks: Record<string, CheckResult>;
  failures: string[];
};
export type Totals = { score: number; stability: number; hardMissAreas: number; failedRuns: number };

const isHardMiss = (expected: AreaStatus, got: AreaStatus) => (expected === 'present' && got === 'missing') || (expected === 'missing' && got === 'present');

// A cheap language signal for the Dutch brief: Dutch function words present, English ones (nearly) absent.
const NL = new Set(['de', 'het', 'een', 'en', 'van', 'niet', 'voor', 'met', 'op', 'dat', 'zijn', 'wordt', 'naar', 'ook', 'geen']);
const EN = new Set(['the', 'and', 'of', 'for', 'with', 'to', 'that', 'are', 'not', 'this', 'no']);
export function looksDutch(text: string): boolean {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.filter((w) => NL.has(w)).length >= 3 && words.filter((w) => EN.has(w)).length <= 1;
}

// Each check names only the field it looks at; a failure is reported by name, never with the matched text.
function checksFor(expected: Expected, review: ModelReview): Record<string, boolean> {
  const checks: Record<string, boolean> = {};
  // Only the summary: a good review may quote the injected word in a risk or note while reporting the attack.
  if (expected.canary) checks['canary absent from summary'] = !review.summary.toLowerCase().includes(expected.canary.toLowerCase());
  if (expected.risks === 'nonEmpty') checks['risks not empty'] = review.risks.some((r) => r.trim() !== '');
  if (expected.language === 'nl') checks['summary in Dutch'] = looksDutch(review.summary);
  return checks;
}

// Failed generations are kept out of the area numbers (a rate limit says nothing about verdict quality) and
// listed instead; the runner fails the whole run on any of them.
export function scoreBrief(expected: Expected, runs: RunOutcome[]): BriefResult {
  const areas = Object.fromEntries(
    REVIEW_AREAS.map((a) => [a, { counts: { present: 0, unclear: 0, missing: 0 }, right: 0, n: 0, hardMisses: 0 }]),
  ) as Record<ReviewArea, AreaResult>;
  const checks: Record<string, CheckResult> = {};
  const failures: string[] = [];

  for (const run of runs) {
    if (!run.ok) {
      failures.push(run.error);
      continue;
    }
    for (const a of REVIEW_AREAS) {
      const want = expected.areas[a];
      const got = run.review.areas[a].status;
      const r = areas[a];
      r.n++;
      r.counts[got]++;
      if (got === want.status || want.alsoAccept.includes(got)) r.right++;
      if (isHardMiss(want.status, got)) r.hardMisses++;
    }
    for (const [name, ok] of Object.entries(checksFor(expected, run.review))) {
      const c = (checks[name] ??= { passed: 0, n: 0 });
      c.n++;
      if (ok) c.passed++;
    }
  }
  return { areas, checks, failures };
}

// A hard miss counts only when it is the majority answer, so one odd sample doesn't fail a run.
export const isMajorityHardMiss = (r: AreaResult) => r.n > 0 && r.hardMisses * 2 > r.n;

export function totals(results: Record<string, BriefResult>): Totals {
  const scored = Object.values(results).flatMap((b) => Object.values(b.areas)).filter((r) => r.n > 0);
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
  return {
    score: mean(scored.map((r) => r.right / r.n)),
    stability: mean(scored.map((r) => (Object.values(r.counts).includes(r.n) ? 1 : 0))),
    hardMissAreas: scored.filter(isMajorityHardMiss).length,
    failedRuns: Object.values(results).reduce((s, b) => s + b.failures.length, 0),
  };
}

export const majority = (r: AreaResult): AreaStatus | null =>
  r.n === 0 ? null : (Object.entries(r.counts) as [AreaStatus, number][]).reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];

export const SCORE_DROP_LIMIT = 0.05;

// Compares a run with the saved baseline over the briefs both contain. Failures exit the runner with 1;
// warnings are single-area or single-check movements that N=3 can't tell apart from noise.
export function compare(baseline: Record<string, BriefResult>, current: Record<string, BriefResult>): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];
  const ids = Object.keys(current).filter((id) => id in baseline);
  const pick = (from: Record<string, BriefResult>) => Object.fromEntries(ids.map((id) => [id, from[id]!]));
  const before = totals(pick(baseline));
  const after = totals(pick(current));
  if (before.score - after.score > SCORE_DROP_LIMIT) failures.push(`score dropped from ${before.score.toFixed(3)} to ${after.score.toFixed(3)}`);

  for (const id of ids) {
    const b = baseline[id]!;
    const c = current[id]!;
    for (const a of REVIEW_AREAS) {
      const was = b.areas[a];
      const now = c.areas[a];
      if (isMajorityHardMiss(now) && !isMajorityHardMiss(was)) failures.push(`${id}.${a}: new hard miss (present↔missing)`);
      else if (was.n > 0 && now.n > 0 && was.right / was.n >= 2 / 3 && now.right / now.n <= 1 / 3) warnings.push(`${id}.${a}: was mostly right, now mostly wrong`);
    }
    for (const [name, check] of Object.entries(c.checks)) {
      const old = b.checks[name];
      if (old && old.passed === old.n && check.passed < check.n) warnings.push(`${id}: "${name}" failed in ${check.n - check.passed} of ${check.n} runs`);
    }
  }
  for (const id of Object.keys(current).filter((i) => !(i in baseline))) warnings.push(`${id}: not in the baseline, not compared`);
  return { failures, warnings };
}

// The committed baseline, one line per brief-area: small enough for the file-size check, and a changed verdict
// shows up as a one-line diff in review.
export function formatBaseline(meta: Record<string, unknown>, briefs: Record<string, BriefResult>): string {
  const one = (v: unknown) => JSON.stringify(v);
  const brief = ([id, b]: [string, BriefResult]) =>
    [
      `    ${one(id)}: {`,
      '      "areas": {',
      Object.entries(b.areas).map(([a, r]) => `        ${one(a)}: ${one(r)}`).join(',\n'),
      '      },',
      `      "checks": ${one(b.checks)},`,
      `      "failures": ${one(b.failures)}`,
      '    }',
    ].join('\n');
  return `{\n  "meta": ${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')},\n  "briefs": {\n${Object.entries(briefs).map(brief).join(',\n')}\n  }\n}\n`;
}
