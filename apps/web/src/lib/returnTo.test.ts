import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './returnTo';

describe('safeReturnPath', () => {
  it('keeps an in-app path', () => {
    expect(safeReturnPath('/w/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe('/w/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it.each([undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    'falls back to / for %s',
    (uri) => {
      expect(safeReturnPath(uri)).toBe('/');
    },
  );
});
