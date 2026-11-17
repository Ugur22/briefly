import { describe, expect, it } from 'vitest';
import { Workspace, WorkspaceParams } from './identity';

const id = '6f1c2b0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c';

describe('Workspace', () => {
  it('accepts a known role', () => {
    expect(Workspace.safeParse({ id, name: 'Acme', role: 'approver' }).success).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(Workspace.safeParse({ id, name: 'Acme', role: 'owner' }).success).toBe(false);
  });
});

describe('WorkspaceParams', () => {
  it('rejects a non-uuid id before it reaches the database', () => {
    expect(WorkspaceParams.safeParse({ wsId: 'acme' }).success).toBe(false);
  });
});
