import { expect, test, type Page } from '@playwright/test';
import { baseRoutes, briefPath, briefRoutes, mockApi, workspacePath, type Routes } from './mockApi';
import { pinClock, seedSession } from './session';

// The README screenshots, committed under docs/. Opt-in so the visual check doesn't rewrite them:
// README_SHOTS=1 bunx playwright test e2e/readme.spec.ts
test.skip(!process.env.README_SHOTS, 'set README_SHOTS=1 to refresh the README screenshots');

type Shot = {
  name: string;
  project: 'desktop' | 'mobile';
  path: string;
  routes?: Routes;
  // Viewport shots, not full page: the sidebar is viewport-high, so a full-page shot cuts it off.
  scrollTo?: (page: Page) => ReturnType<Page['getByRole']>;
  height: number;
};

const shots: Shot[] = [
  { name: 'briefs', project: 'desktop', path: workspacePath, height: 720 },
  {
    name: 'review',
    project: 'desktop',
    path: briefPath('reviewed'),
    routes: briefRoutes('reviewed', 'done'),
    scrollTo: (page) => page.getByRole('heading', { name: 'AI review', exact: true }),
    height: 900,
  },
  { name: 'approve', project: 'desktop', path: briefPath('inReview'), routes: briefRoutes('inReview', 'locked'), height: 720 },
  {
    name: 'review-mobile',
    project: 'mobile',
    path: briefPath('reviewed'),
    routes: briefRoutes('reviewed', 'done'),
    scrollTo: (page) => page.getByRole('heading', { name: 'AI review', exact: true }),
    height: 860,
  },
];

for (const shot of shots) {
  test(shot.name, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== shot.project);
    const origin = new URL(testInfo.project.use.baseURL ?? '').origin;
    await page.setViewportSize({ width: page.viewportSize()?.width ?? 1280, height: shot.height });
    await pinClock(page);
    await seedSession(page, origin);
    await mockApi(page, { ...baseRoutes, ...shot.routes });

    await page.goto(shot.path);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    if (shot.scrollTo) {
      const target = shot.scrollTo(page).filter({ visible: true }).first();
      await expect(target).toBeVisible();
      await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    }
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${testInfo.project.testDir}/../../../docs/screenshots/${shot.name}.png`, animations: 'disabled' });
  });
}
