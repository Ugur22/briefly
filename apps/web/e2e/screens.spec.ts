import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { baseRoutes, briefPath, briefRoutes, mockApi, workspacePath, type Routes } from './mockApi';
import { pinClock, seedSession } from './session';

type Screen = {
  name: string;
  path: string;
  routes?: Routes;
  signedIn?: false;
  // What only the finished screen shows, so a loading or error state never gets captured.
  ready: (page: Page) => Locator | Locator[];
  act?: (page: Page) => Promise<void>;
};

const button = (name: string) => (page: Page) => page.getByRole('button', { name, exact: true });
const text = (t: string | RegExp) => (page: Page) => page.getByText(t).first();
const heading = (name: string) => (page: Page) => page.getByRole('heading', { name, exact: true });
// Locked screens render the status column before the review arrives; wait for both.
const withReview = (ready: (page: Page) => Locator) => (page: Page) => [ready(page), heading('Questions for the client')(page)];

const screens: Screen[] = [
  { name: 'sign-in', path: '/', signedIn: false, ready: button('Sign in with Okta') },
  { name: 'workspaces', path: '/', ready: heading('Your workspaces') },
  { name: 'workspaces-empty', path: '/', routes: { 'GET /api/workspaces': { workspaces: [] } }, ready: text(/not in any workspace/) },
  { name: 'briefs', path: workspacePath, ready: heading('Briefs') },
  {
    name: 'briefs-empty',
    path: workspacePath,
    routes: { [`GET /api${workspacePath.replace('/w/', '/workspaces/')}/briefs`]: { briefs: [], permissions: { create: true } } },
    ready: text('No briefs yet.'),
  },
  { name: 'brief-no-review', path: briefPath('draft'), routes: briefRoutes('draft', 'none'), ready: button('Generate AI review') },
  { name: 'brief-review-generating', path: briefPath('generating'), routes: briefRoutes('generating', 'generating'), ready: text(/review is being generated/) },
  { name: 'brief-reviewed', path: briefPath('reviewed'), routes: briefRoutes('reviewed', 'done'), ready: heading('Questions for the client') },
  { name: 'brief-review-outdated', path: briefPath('outdated'), routes: briefRoutes('outdated', 'outdated'), ready: text(/brief changed after this review/) },
  {
    name: 'brief-review-editing',
    path: briefPath('reviewed'),
    routes: briefRoutes('reviewed', 'done'),
    act: async (page) => page.getByRole('button', { name: 'Edit review' }).click(),
    ready: (page) => page.getByRole('form', { name: 'Edit review' }),
  },
  {
    name: 'brief-edit',
    path: briefPath('reviewed'),
    routes: briefRoutes('reviewed', 'done'),
    act: async (page) => page.getByRole('button', { name: 'Edit', exact: true }).click(),
    ready: heading('Edit brief'),
  },
  { name: 'brief-in-review-approver', path: briefPath('inReview'), routes: briefRoutes('inReview', 'locked'), ready: withReview(button('Approve')) },
  { name: 'brief-in-review-submitter', path: briefPath('mine'), routes: briefRoutes('mine', 'locked'), ready: withReview(text(/You submitted this brief/)) },
  { name: 'brief-changes-requested', path: briefPath('changes'), routes: briefRoutes('changes', 'done'), ready: button('Resubmit for human review') },
  { name: 'brief-approved', path: briefPath('approved'), routes: briefRoutes('approved', 'locked'), ready: withReview(text(/This brief is final/)) },
  { name: 'brief-uploaded', path: briefPath('uploaded'), routes: briefRoutes('uploaded', 'done'), ready: text('Noordzee_Q1-2027_brief_v2.pdf') },
  { name: 'new-brief-paste', path: `${workspacePath}/briefs/new`, ready: heading('New brief') },
  {
    name: 'new-brief-upload',
    path: `${workspacePath}/briefs/new`,
    act: async (page) => page.getByText('Upload a file').click(),
    ready: text('Choose a file'),
  },
];

for (const screen of screens) {
  test(screen.name, async ({ page }, testInfo) => {
    const origin = new URL(testInfo.project.use.baseURL ?? '').origin;
    await pinClock(page);
    if (screen.signedIn !== false) await seedSession(page, origin);
    const unexpected = await mockApi(page, { ...baseRoutes, ...screen.routes });

    await page.goto(screen.path);
    // A screen that fell back to the sign-in card fails here instead of producing a misleading shot.
    if (screen.signedIn !== false) await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await screen.act?.(page);
    for (const ready of [screen.ready(page)].flat()) await expect(ready).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    // SHOT_SET keeps each design-review pass in its own folder, so passes can be compared.
    const set = process.env.SHOT_SET ? `${process.env.SHOT_SET}/` : '';
    await page.screenshot({
      path: `${testInfo.project.testDir}/screenshots/${set}${testInfo.project.name}/${screen.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    expect(unexpected).toEqual([]);

    // The measurable half of design review; the rest is ui-designer's judgement.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(serious).toEqual([]);
  });
}

test('updates an outdated assessment before human submission', async ({ page }, testInfo) => {
  const origin = new URL(testInfo.project.use.baseURL ?? '').origin;
  await pinClock(page);
  await seedSession(page, origin);
  const path = briefPath('reviewed');
  const current = briefRoutes('reviewed', 'done');
  const reviewPath = `/api${path.replace('/w/', '/workspaces/')}/review`;
  await mockApi(page, {
    ...baseRoutes,
    ...briefRoutes('reviewed', 'outdated'),
    [`POST ${reviewPath}`]: current[`GET ${reviewPath}`],
  });
  await page.goto(path);
  const update = page.getByRole('button', { name: 'Update AI review' });
  await expect(update).toBeVisible();
  const submit = page.getByRole('button', { name: 'Submit for human review' });
  await expect(submit).toHaveCount(0);
  await update.click();
  await expect(submit).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  if (testInfo.project.name === 'mobile') await page.locator('summary').filter({ hasText: 'Findings from the last AI review' }).click();
  await expect(page.getByText('What budget range should we plan media and production against?').filter({ visible: true })).toBeVisible();
});
