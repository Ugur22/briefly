import { describe, expect, it } from 'vitest';
import { BRIEF_BODY_MAX, BRIEF_TITLE_MAX, BriefCreate, BriefUpdate } from './briefs';

describe('BriefCreate', () => {
  it('trims the title and rejects one that is only whitespace', () => {
    expect(BriefCreate.parse({ title: '  Spring launch ', body: '' }).title).toBe('Spring launch');
    expect(BriefCreate.safeParse({ title: '   ', body: 'x' }).success).toBe(false);
  });

  it('rejects text past the limits', () => {
    expect(BriefCreate.safeParse({ title: 't'.repeat(BRIEF_TITLE_MAX + 1), body: '' }).success).toBe(false);
    expect(BriefCreate.safeParse({ title: 't', body: 'b'.repeat(BRIEF_BODY_MAX + 1) }).success).toBe(false);
  });

  // Zod 4 counts code points, as Postgres char_length does, so the contract and the database check agree exactly
  // and nothing Node accepts can trip the check (which would log the row, brief text included).
  it('counts code points like Postgres, so an emoji counts once', () => {
    const atLimit = '😀'.repeat(BRIEF_BODY_MAX);
    expect(BriefCreate.safeParse({ title: 't', body: atLimit }).success).toBe(true);
    expect(BriefCreate.safeParse({ title: 't', body: `${atLimit}😀` }).success).toBe(false);
  });
});

describe('characters Postgres cannot store', () => {
  it.each([
    ['NUL', 'a\0b'],
    ['a lone high surrogate', 'a\uD800b'],
    ['a lone low surrogate', 'a\uDC00b'],
  ])('refuses %s in title and body', (_, bad) => {
    expect(BriefCreate.safeParse({ title: bad, body: '' }).success).toBe(false);
    expect(BriefCreate.safeParse({ title: 'ok', body: bad }).success).toBe(false);
  });

  it('accepts a proper surrogate pair', () => {
    expect(BriefCreate.safeParse({ title: 'ok 😀', body: '😀' }).success).toBe(true);
  });
});

describe('BriefUpdate', () => {
  it('requires the version being edited', () => {
    expect(BriefUpdate.safeParse({ title: 't', body: '' }).success).toBe(false);
    expect(BriefUpdate.safeParse({ title: 't', body: '', version: 3 }).success).toBe(true);
  });
});
