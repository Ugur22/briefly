import { HealthResponse, Me, Workspace } from '@briefly/contracts';

// Every screenshot happens at this instant, so relative dates and token expiry never drift.
export const PINNED = new Date('2026-11-17T09:30:00+01:00');

export const me = Me.parse({ id: '0b6f3a52-7c1e-4d8a-9f21-3c5e8a7d4b10', email: 'sanne.devries@agency.example' });
export const colleague = '5d2c8e41-9a3b-4f6e-8c7d-1e2f3a4b5c6d';

export const health = HealthResponse.parse({ status: 'ok', version: '0.9.0', commit: 'f498a67' });

export const noordzee = Workspace.parse({ id: '3f1c9a7e-2b4d-4e8f-a1c3-5d7e9f0b2a4c', name: 'Noordzee Energie', role: 'admin' });
export const workspaces = [
  noordzee,
  Workspace.parse({ id: '8a2e4c6f-1b3d-4a5e-9c7f-0d2e4f6a8b1c', name: 'Hollandse Fietsfabriek', role: 'editor' }),
  Workspace.parse({ id: 'c4e6a8b2-3d5f-4c7e-8a9b-1f3e5d7c9a2b', name: 'Stadsbakkerij Utrecht', role: 'approver' }),
];
