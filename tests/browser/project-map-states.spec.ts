import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { MapStatus } from '../../packages/contracts/src/map.ts';
import { resetTestDatabase } from './database.ts';
import {
  combinedFixture,
  monoFixture,
  REPO_ROOT,
  serveMap,
  type MapFixture,
} from './map-fixture.ts';
import { addProject, openMap, screenshot, tree } from './map-page.ts';
import { seedChats } from './sidebar-seed.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function openEmptyMap(page: Page, theme = 'graphite') {
  await page.addInitScript((skin) => {
    localStorage.setItem('spark-outpost.view', 'map');
    localStorage.setItem('spark-outpost.theme', skin);
  }, theme);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your code, as a night sky' })).toBeVisible();
}

const skin = (page: Page, name: string) =>
  page.evaluate((value) => (document.documentElement.dataset.skin = value), name);

test('with no projects the Map explains itself and Add a project opens the folder picker', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openEmptyMap(page);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'See the shape of a repo',
    'Know what’s Core',
    'See what a chat changed',
    'Link frontend and backend',
  ]);
  await expect(page.getByText(/never slow down chats/)).toBeVisible();
  const fits = await page
    .locator('.map-hello')
    .evaluate((element) => element.scrollHeight <= element.clientHeight);
  expect(fits).toBe(true);
  await screenshot(page, 'map-empty-dark');
  await skin(page, 'light');
  await screenshot(page, 'map-empty-light');

  await page.getByRole('button', { name: 'More about what Jev reads' }).click();
  await expect(page.getByRole('tooltip')).toContainText('never sent');
  await page.getByRole('button', { name: 'Add a project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a project folder' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('the empty Map fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openEmptyMap(page);
  await expect(page.getByRole('button', { name: 'Add a project' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await screenshot(page, 'map-empty-phone');
});

test('with reduced motion the empty sky holds still with the constellation drawn', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openEmptyMap(page);
  const scout = page.locator('.mh-scout');
  const before = await scout.getAttribute('style');
  await expect(page.locator('.mh-edge.on')).toHaveCount(3);
  await page.waitForTimeout(3000);
  expect(await scout.getAttribute('style')).toBe(before);
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) =>
          ((animation.effect as KeyframeEffect | null)?.target as Element | null)?.matches(
            '.mh-star, .mh-dust, .mh-edge, .mh-scout',
          ),
        ).length,
  );
  expect(running).toBe(0);
});

test('a failed projects request offers a retry instead of the empty state', async ({ page }) => {
  const projectId = await addProject(page, REPO_ROOT);
  const fixture = monoFixture(projectId);
  await page.route(/\/api\/projects$/, (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'map'));
  await serveMap(page, fixture);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Spark can’t reach its server' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a project' })).toHaveCount(0);
  await screenshot(page, 'map-unreachable-dark');
  await page.unroute(/\/api\/projects$/);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(tree(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your code, as a night sky' })).toHaveCount(0);
});

function building(fixture: MapFixture, projectId: string, status: Partial<MapStatus>) {
  const map = fixture.projects.get(projectId)!;
  map.areas = [];
  map.status = { ...map.status, status: 'building', ...status };
}

const stageItems = (page: Page) =>
  page.getByRole('list', { name: 'Build stages' }).getByRole('listitem');

test('the build card shows each stage and says when Jev is really involved', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const projectId = await addProject(page, REPO_ROOT);
  const fixture = monoFixture(projectId);
  building(fixture, projectId, { phase: 'index', progress: { done: 1240, total: 5487 } });
  await openMap(page, fixture);
  await expect(page.getByText('Reading files · 1,240 / 5,487')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reading files… 1,240/5,487' })).toBeVisible();
  await expect(stageItems(page)).toHaveText(['Reader, working', 'Tracer, up next', 'Jev, up next']);
  await screenshot(page, 'map-building-read');

  const stages: [string, Partial<MapStatus>, string, string[]][] = [
    [
      'trace',
      { phase: 'graph', progress: { done: 0, total: 0 } },
      'Tracing imports and grouping areas…',
      ['Reader, done', 'Tracer, working', 'Jev, up next'],
    ],
    [
      'jev',
      { phase: 'labels', progress: { done: 34, total: 268 }, jevAreas: 268 },
      'Jev is labelling areas · 34 / 268',
      ['Reader, done', 'Tracer, done', 'Jev, working'],
    ],
    [
      'no-jev',
      { phase: 'labels', progress: { done: 34, total: 268 }, jevAreas: 0 },
      'Jev not connected, labelling with rules · 34 / 268',
      ['Reader, done', 'Tracer, done', 'Jev, asleep'],
    ],
    [
      'paused',
      { status: 'paused', phase: 'graph', progress: { done: 0, total: 0 }, jevAreas: null },
      'Paused while agents run. I’ll pick up when they finish.',
      ['Reader, done', 'Tracer, asleep', 'Jev, asleep'],
    ],
  ];
  for (const [name, status, text, items] of stages) {
    building(fixture, projectId, status);
    await page.reload();
    await expect(page.getByText(text)).toBeVisible();
    await expect(stageItems(page)).toHaveText(items);
    await screenshot(page, `map-building-${name}`);
  }
  await expect(page.getByRole('button', { name: 'Paused' })).toBeVisible();

  building(fixture, projectId, {
    status: 'building',
    phase: 'labels',
    progress: { done: 34, total: 268 },
    jevAreas: 268,
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Jev labelling… 34/268' })).toBeVisible();
  await skin(page, 'light');
  await screenshot(page, 'map-building-jev-light');
});

test('a combined build adds the linker stage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const web = await addProject(page, path.join(REPO_ROOT, 'apps/web'));
  const server = await addProject(page, path.join(REPO_ROOT, 'apps/server'));
  const fixture = combinedFixture(web, server);
  building(fixture, server, { phase: 'links', progress: { done: 1, total: 2 } });
  await openMap(page, fixture, 'graphite', [web, server]);
  await expect(page.getByText('Linking projects · 1 / 2')).toBeVisible();
  await expect(stageItems(page)).toHaveText([
    'Reader, done',
    'Tracer, done',
    'Jev, done',
    'Linker, working',
  ]);
  await screenshot(page, 'map-building-links');
});

test('the toolbar keeps its controls quiet and named', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  const fixture = monoFixture(projectId);
  await openMap(page, fixture);
  const changes = page.getByRole('switch', { name: /This chat’s changes/ });
  await expect(changes).toHaveAttribute('aria-disabled', 'true');
  await changes.click({ force: true });
  await expect(changes).toHaveAttribute('aria-checked', 'false');
  await page.mouse.move(0, 0);
  await changes.hover();
  await expect(page.getByRole('tooltip')).toHaveText(
    'No chat has changed files in this project yet',
  );
  const legend = page.getByRole('button', { name: 'Legend', exact: true });
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await legend.click();
  await expect(page.getByRole('region', { name: 'How to read the sky' })).toHaveCount(0);
  await legend.click();
  await expect(page.getByRole('region', { name: 'How to read the sky' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Review areas/ })).toBeVisible();
});

test('toolbar screenshots with this chat’s changes on', async ({ page }) => {
  test.skip(!process.env.SPARK_SHOTS, 'screenshots only');
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  const fixture = monoFixture(projectId);
  await seedChats([
    { title: 'Retire old models', projectIds: [projectId], run: { status: 'succeeded' } },
  ]);
  await page.route(/\/api\/runs\/[^/]+\/changes$/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        revertible: true,
        revertedAt: null,
        reason: null,
        files: fixture.changedPaths.map((p) => ({ path: p, change: 'modified' })),
      }),
    }),
  );
  await openMap(page, fixture);
  await page.getByRole('switch', { name: /This chat’s changes/ }).click();
  await page.getByRole('switch', { name: 'Include dependents' }).click();
  await screenshot(page, 'map-toolbar-after-dark');
  await skin(page, 'light');
  await screenshot(page, 'map-toolbar-after-light');
  await page.setViewportSize({ width: 1024, height: 768 });
  await screenshot(page, 'map-toolbar-after-narrow-light');
  await page.setViewportSize({ width: 375, height: 812 });
  await screenshot(page, 'map-toolbar-after-phone-light');
});
