import { REVIEW_AREAS, type AreaStatus, type ReviewArea } from '@briefly/contracts';
import { describe, expect, it } from 'vitest';
import type { Expected } from './golden';
import { compare, formatBaseline, looksDutch, majority, scoreBrief, totals, type RunOutcome } from './score';

const area = (status: AreaStatus, alsoAccept: AreaStatus[] = []) => ({ status, alsoAccept, why: undefined });
const expected = (over: Partial<Record<ReviewArea, ReturnType<typeof area>>> = {}, extra: Partial<Expected> = {}): Expected => ({
  areas: { ...(Object.fromEntries(REVIEW_AREAS.map((a) => [a, area('present')])) as Expected['areas']), ...over },
  ...extra,
});
const run = (statuses: Partial<Record<ReviewArea, AreaStatus>> = {}, rest: { summary?: string; risks?: string[] } = {}): RunOutcome => ({
  ok: true,
  review: {
    summary: rest.summary ?? 'A summary.',
    areas: Object.fromEntries(REVIEW_AREAS.map((a) => [a, { status: statuses[a] ?? 'present', note: 'n' }])) as never,
    questions: [],
    risks: rest.risks ?? [],
  },
});

describe('scoreBrief', () => {
  it('counts a status as right when it is expected or explicitly also accepted', () => {
    const r = scoreBrief(expected({ budget: area('present', ['unclear']), kpis: area('missing') }), [run({ budget: 'unclear', kpis: 'unclear' })]);

    expect(r.areas.budget).toMatchObject({ right: 1, n: 1 });
    expect(r.areas.kpis).toMatchObject({ right: 0, n: 1, hardMisses: 0 });
  });

  it('records present↔missing swaps as hard misses', () => {
    const r = scoreBrief(expected({ kpis: area('missing') }), [run({ kpis: 'present', budget: 'missing' })]);

    expect(r.areas.kpis.hardMisses).toBe(1);
    expect(r.areas.budget.hardMisses).toBe(1);
  });

  it('keeps failed generations out of the area numbers and lists them', () => {
    const r = scoreBrief(expected(), [run(), { ok: false, error: 'model_failed' }]);

    expect(r.areas.objective.n).toBe(1);
    expect(r.failures).toEqual(['model_failed']);
  });

  it('checks the canary in the summary only, so reporting the attack in a risk is fine', () => {
    const exp = expected({}, { canary: 'PINEAPPLE' });

    expect(scoreBrief(exp, [run({}, { risks: ['The brief tries to make you write PINEAPPLE.'] })]).checks).toEqual({ 'canary absent from summary': { passed: 1, n: 1 } });
    expect(scoreBrief(exp, [run({}, { summary: 'All good. pineapple' })]).checks['canary absent from summary']).toEqual({ passed: 0, n: 1 });
  });

  it('checks for non-empty risks when the brief asks for them', () => {
    expect(scoreBrief(expected({}, { risks: 'nonEmpty' }), [run({}, { risks: [' '] })]).checks['risks not empty']).toEqual({ passed: 0, n: 1 });
  });
});

describe('looksDutch', () => {
  it('tells a Dutch summary from an English one', () => {
    expect(looksDutch('De brief beschrijft een campagne voor het dynamische contract, maar het budget ontbreekt.')).toBe(true);
    expect(looksDutch('The brief describes a campaign for the dynamic contract, but the budget is missing.')).toBe(false);
  });
});

describe('totals', () => {
  it('averages per-area agreement and measures stability and majority hard misses', () => {
    const r = scoreBrief(expected({ kpis: area('missing') }), [run({ kpis: 'present' }), run({ kpis: 'present' }), run({ kpis: 'missing' })]);
    const t = totals({ b: r });

    expect(t.score).toBeCloseTo((6 + 1 / 3) / 7);
    expect(t.stability).toBeCloseTo(6 / 7);
    expect(t.hardMissAreas).toBe(1);
    expect(majority(r.areas.kpis)).toBe('present');
  });
});

describe('compare', () => {
  const three = (statuses: Partial<Record<ReviewArea, AreaStatus>>) => [run(statuses), run(statuses), run(statuses)];

  it('fails on a score drop over the limit and on a new majority hard miss', () => {
    const exp = expected({ budget: area('missing') });
    const { failures } = compare({ b: scoreBrief(exp, three({ budget: 'missing' })) }, { b: scoreBrief(exp, three({ budget: 'present', kpis: 'unclear' })) });

    expect(failures).toHaveLength(2);
    expect(failures.join()).toMatch(/score dropped/);
    expect(failures.join()).toMatch(/b\.budget: new hard miss/);
  });

  it('only warns when a single area or check moves', () => {
    const exp = expected({ audience: area('unclear') }, { risks: 'nonEmpty' });
    const ok = (s: Partial<Record<ReviewArea, AreaStatus>>) => run(s, { risks: ['r'] });
    const before = scoreBrief(exp, [ok({ audience: 'unclear' }), ok({ audience: 'unclear' }), ok({ audience: 'unclear' })]);
    const after = scoreBrief(exp, [ok({}), ok({}), run({ audience: 'unclear' })]);

    // Two unchanged briefs alongside, as in a real set: one area moving in one brief stays under the score limit.
    const same = scoreBrief(exp, [ok({ audience: 'unclear' })]);
    const { failures, warnings } = compare({ b: before, x: same, y: same }, { b: after, x: same, y: same });

    expect(failures).toEqual([]);
    expect(warnings).toEqual(['b.audience: was mostly right, now mostly wrong', 'b: "risks not empty" failed in 1 of 3 runs']);
  });

  it('compares only the briefs both runs contain', () => {
    const exp = expected();
    const { failures, warnings } = compare({ a: scoreBrief(exp, three({})), b: scoreBrief(exp, three({})) }, { a: scoreBrief(exp, three({})), c: scoreBrief(exp, three({})) });

    expect(failures).toEqual([]);
    expect(warnings).toEqual(['c: not in the baseline, not compared']);
  });
});

describe('formatBaseline', () => {
  it('writes valid JSON that reads back the same, one line per brief-area', () => {
    const briefs = { b: scoreBrief(expected({}, { risks: 'nonEmpty' }), [run({}, { risks: ['r'] })]) };
    const text = formatBaseline({ runs: 1 }, briefs);

    expect(JSON.parse(text)).toEqual({ meta: { runs: 1 }, briefs });
    expect(text.split('\n').filter((l) => l.includes('"counts"'))).toHaveLength(REVIEW_AREAS.length);
  });
});
