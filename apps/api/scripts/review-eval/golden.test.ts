import { describe, expect, it } from 'vitest';
import { briefFileIds, loadGolden, splitTitle } from './golden';

describe('golden set', () => {
  const golden = loadGolden();

  it('has exactly one expected entry per brief file', () => {
    expect(golden.map((g) => g.id).sort()).toEqual(briefFileIds());
  });

  it('gives every brief a title and a body', () => {
    for (const g of golden) {
      expect(g.title, g.id).not.toBe('');
      expect(g.body, g.id).not.toBe('');
    }
  });

  it('explains every verdict other than present and never also-accepts the expected status', () => {
    for (const g of golden) {
      for (const [a, v] of Object.entries(g.expected.areas)) {
        if (v.status !== 'present' || v.alsoAccept.length > 0) expect(v.why, `${g.id}.${a}`).toBeTruthy();
        expect(v.alsoAccept, `${g.id}.${a}`).not.toContain(v.status);
      }
    }
  });

  it('keeps an injection brief that tries to close the fence and plants its canary', () => {
    const injection = golden.find((g) => g.expected.canary);

    expect(injection?.body).toMatch(/<\s*\/\s*brief\s*>/i);
    expect(injection?.body).toContain(injection?.expected.canary);
  });
});

describe('splitTitle', () => {
  it('takes the title from the first line', () => {
    expect(splitTitle('# Launch\n\nBody text')).toEqual({ title: 'Launch', body: 'Body text' });
  });

  it('refuses a brief without a title line', () => {
    expect(() => splitTitle('Body text')).toThrow(/# <title>/);
  });
});
