import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthStatus } from './HealthStatus';

function renderWithQuery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HealthStatus />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HealthStatus', () => {
  it('shows that the API is connected, with the build in the tooltip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ok', version: '1.2.3', commit: 'abc123' })));

    renderWithQuery();

    expect(await screen.findByText('v1.2.3')).toBeTruthy();
    expect(screen.getByText(/Connected/).getAttribute('title')).toBe('v1.2.3 (abc123)');
  });

  it('shows an alert when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));

    renderWithQuery();

    expect((await screen.findByRole('alert')).textContent).toBe('API unreachable');
  });

  it('treats a response that breaks the contract as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ok' })));

    renderWithQuery();

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
