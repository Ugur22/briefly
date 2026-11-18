// Loads the golden set: synthetic briefs in golden/<id>.md and their expected verdicts in golden/expected.json.
// Pure file reading, no model calls, so offline tests import this and never run.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AreaStatus, REVIEW_AREAS, type ReviewArea } from '@briefly/contracts';
import { z } from 'zod';

export const GOLDEN_DIR = join(import.meta.dirname, 'golden');

const Area = z.union([
  AreaStatus.transform((status) => ({ status, alsoAccept: [] as AreaStatus[], why: undefined as string | undefined })),
  z.strictObject({ status: AreaStatus, alsoAccept: z.array(AreaStatus).default([]), why: z.string().min(1).optional() }),
]);
const Expected = z.strictObject({
  areas: z.strictObject(Object.fromEntries(REVIEW_AREAS.map((a) => [a, Area])) as Record<ReviewArea, typeof Area>),
  canary: z.string().min(1).optional(),
  risks: z.literal('nonEmpty').optional(),
  language: z.literal('nl').optional(),
});
export type Expected = z.infer<typeof Expected>;
export const ExpectedFile = z.record(z.string().regex(/^[a-z0-9-]+$/), Expected);

export type GoldenBrief = { id: string; title: string; body: string; expected: Expected };

// The first line `# <title>` becomes the title, as the API receives title and body separately.
export function splitTitle(markdown: string): { title: string; body: string } {
  const [first = '', ...rest] = markdown.split('\n');
  const match = /^#\s+(.+)$/.exec(first);
  if (!match?.[1]) throw new Error('a golden brief must start with "# <title>"');
  return { title: match[1].trim(), body: rest.join('\n').trim() };
}

export function briefFileIds(dir = GOLDEN_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
}

export function loadGolden(dir = GOLDEN_DIR): GoldenBrief[] {
  const expected = ExpectedFile.parse(JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')));
  return Object.entries(expected).map(([id, exp]) => ({ id, ...splitTitle(readFileSync(join(dir, `${id}.md`), 'utf8')), expected: exp }));
}
