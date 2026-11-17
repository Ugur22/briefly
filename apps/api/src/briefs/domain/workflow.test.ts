import { describe, expect, it } from 'vitest';
import { briefActions, isEditableStatus } from './workflow';

describe('briefActions', () => {
  it.each([
    ['editor', 'draft', { edit: true, delete: false, submit: true, decide: false }],
    ['editor', 'in_review', { edit: false, delete: false, submit: false, decide: false }],
    ['editor', 'changes_requested', { edit: true, delete: false, submit: true, decide: false }],
    ['approver', 'draft', { edit: false, delete: false, submit: false, decide: false }],
    ['approver', 'in_review', { edit: false, delete: false, submit: false, decide: true }],
    ['admin', 'in_review', { edit: false, delete: true, submit: false, decide: true }],
    ['admin', 'approved', { edit: false, delete: true, submit: false, decide: false }],
  ] as const)('%s on a %s brief', (role, status, expected) => {
    expect(briefActions(role, status)).toEqual(expected);
  });
});

describe('isEditableStatus', () => {
  it('locks briefs that are in review or approved', () => {
    expect(['draft', 'in_review', 'approved', 'changes_requested'].filter((s) => isEditableStatus(s as never))).toEqual(['draft', 'changes_requested']);
  });
});
