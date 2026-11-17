import type { Page } from '@playwright/test';
import { briefId, briefList, briefResponse, type BriefKey } from './fixtures/briefs';
import { reviews } from './fixtures/reviews';
import { health, me, noordzee, workspaces } from './fixtures/workspaces';
import { OKTA_HOST } from './session';

// "GET /api/..." → JSON body. Never 401: main.tsx clears the session on 401 and the shot becomes the sign-in card.
export type Routes = Record<string, unknown>;

const ws = `/api/workspaces/${noordzee.id}`;

export const baseRoutes: Routes = {
  'GET /api/health': health,
  'GET /api/me': me,
  'GET /api/workspaces': { workspaces },
  [`GET ${ws}`]: noordzee,
  [`GET ${ws}/briefs`]: briefList,
};

export const briefPath = (key: BriefKey) => `/w/${noordzee.id}/briefs/${briefId(key)}`;
export const workspacePath = `/w/${noordzee.id}`;

export function briefRoutes(key: BriefKey, review: keyof typeof reviews): Routes {
  const path = `${ws}/briefs/${briefId(key)}`;
  return { [`GET ${path}`]: briefResponse(key), [`GET ${path}/review`]: reviews[review] };
}

// Returns the list of requests nobody mocked (and any that tried to reach Okta), for the test to assert empty.
export async function mockApi(page: Page, routes: Routes): Promise<string[]> {
  const unexpected: string[] = [];

  await page.route(
    (url) => url.hostname === OKTA_HOST,
    (route) => {
      unexpected.push(`okta: ${route.request().method()} ${route.request().url()}`);
      return route.abort();
    },
  );

  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const req = route.request();
      const key = `${req.method()} ${new URL(req.url()).pathname}`;
      if (!(key in routes)) {
        unexpected.push(key);
        return route.fulfill({ status: 500, json: { error: 'unmocked' } });
      }
      return route.fulfill({ json: routes[key] });
    },
  );

  return unexpected;
}
