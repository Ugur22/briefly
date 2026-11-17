import { describe, expect, it } from 'vitest';
import { briefPermissions } from './permissions';

describe('briefPermissions', () => {
  it.each([
    ['editor', { create: true, edit: true, delete: false }],
    ['approver', { create: false, edit: false, delete: false }],
    ['admin', { create: true, edit: true, delete: true }],
  ] as const)('%s', (role, expected) => {
    expect(briefPermissions(role)).toEqual(expected);
  });
});
