import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  combinedFixture,
  monoFixture,
  REPO_ROOT,
  serveMap,
  type MapFixture,
} from './map-fixture.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = path.join(REPO_ROOT, 'docs/design/map/app-screens');
const shoot = process.env.MAP_SCREENS === '1';
const SKY = /map of/;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function addProject(page: Page, rootPath: string): Promise<string> {
  const response = await page.request.post('/api/projects', { data: { rootPath } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

async function openMap(page: Page, fixture: MapFixture, theme = 'graphite', projects?: string[]) {
  await serveMap(page, fixture);
  await page.addInitScript(
    ({ skin, ids }) => {
      localStorage.setItem('spark-outpost.view', 'map');
      localStorage.setItem('spark-outpost.theme', skin);
      if (ids) localStorage.setItem('spark-outpost.map-projects', JSON.stringify(ids));
    },
    { skin: theme, ids: projects ?? null },
  );
  await page.goto('/');
}

async function screenshot(page: Page, name: string) {
  if (!shoot) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const sky = (page: Page) => page.getByRole('application', { name: SKY });
const live = (page: Page) => page.locator('.map-stage [aria-live="polite"]').first();

async function stageCentre(page: Page) {
  const box = (await page.locator('.map-stage').boundingBox())!;
  return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function findFile(page: Page, query: string, option: RegExp) {
  await page.keyboard.press('/');
  const search = page.getByRole('combobox', { name: 'Find a file on the map' });
  await expect(search).toBeFocused();
  await search.fill(query);
  await page.getByRole('option', { name: option }).first().click();
}

test('the sky shows each area as a constellation, with gold names and a legend', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  await openMap(page, monoFixture(projectId));
  await expect(sky(page)).toHaveAccessibleName(/21 areas as constellations/);
  await expect(page.getByRole('region', { name: 'How to read the sky' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Map built' })).toContainText(
    '2 min ago',
  );
  await expect(page.getByRole('button', { name: /^Core/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Feature/ }).click();
  await expect(page.getByRole('button', { name: /^Feature/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: /^Feature/ }).click();
  await screenshot(page, 'sky-dark');
  await page.evaluate(() => (document.documentElement.dataset.skin = 'light'));
  await screenshot(page, 'sky-light');
});

test('arrows walk the areas, Enter opens one as a network and Escape goes back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  await openMap(page, monoFixture(projectId));
  await sky(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(live(page)).toContainText(/area, \d+ files\. Press Enter to open\./);
  const announced = (await live(page).textContent()) ?? '';
  const name = announced.split('.')[0]!;
  await page.keyboard.press('Enter');
  const crumb = page.locator('.map-crumb');
  await expect(crumb.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Area' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tooltip')).toContainText('on this');
  await expect(live(page)).toContainText('files depend on this');
  await screenshot(page, 'area-dark');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /\.(ts|tsx|css|mjs)$/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await sky(page).focus();
  await page.keyboard.press('Escape');
  await expect(crumb).toHaveCount(0);
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('+');
  await page.keyboard.press('0');
});

test('search flies to a file; hovering shows its details and clicking opens a real preview', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const projectId = await addProject(page, REPO_ROOT);
  await openMap(page, monoFixture(projectId));
  await expect(sky(page)).toBeVisible();
  await findFile(page, 'ticket-model.ts', /ticket-model\.ts/);
  await expect(live(page)).toContainText('Found apps/web/src/tickets/ticket-model.ts');
  const { x, y } = await stageCentre(page);
  await page.mouse.move(x, y);
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('apps/web/src/tickets/ticket-model.ts');
  await expect(tip).toContainText(/files? depends? on this/);
  await expect(tip).toContainText('Feature · Tickets · 0.92');
  await screenshot(page, 'hover-dark');
  await page.mouse.click(x, y);
  const sheet = page.getByRole('dialog', { name: 'ticket-model.ts' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Depended on by' })).toBeVisible();
  await expect(sheet.locator('.map-preview')).toContainText('export', { timeout: 15_000 });
  await screenshot(page, 'sheet-dark');
  await sheet.getByRole('button', { name: 'Open in chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'About `apps/web/src/tickets/ticket-model.ts`: ',
  );
});

test('Review areas lists the least confident first and saves a Core, Shared or Feature choice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  const fixture = monoFixture(projectId);
  await openMap(page, fixture, 'light');
  await page.getByRole('button', { name: 'Review areas' }).click();
  const review = page.getByRole('dialog', { name: 'Review areas' });
  await expect(review).toBeVisible();
  const first = review.getByRole('listitem').first();
  await expect(first).toContainText('Projects & ship');
  await expect(first).toContainText('Check this');
  await expect(first).toContainText('0.64');
  const choice = first.getByRole('radiogroup', { name: 'Projects & ship is' });
  const saved = page.waitForRequest((request) => request.method() === 'PUT');
  await choice.getByRole('radio', { name: 'Core' }).click();
  expect((await saved).postDataJSON()).toEqual({ category: 'core' });
  await expect(choice.getByRole('radio', { name: 'Core' })).toHaveAttribute('aria-checked', 'true');
  await expect(first).toContainText('You');
  await expect(
    page.getByRole('status').filter({ hasText: 'Projects & ship is now Core' }),
  ).toBeVisible();
  await screenshot(page, 'review-light');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(choice.getByRole('radio', { name: 'Feature' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(first).toContainText('Check this');
});

test('changes from this chat light up, with the files that depend on them on request', async ({
  page,
}) => {
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
  const changes = page.getByRole('switch', { name: /Show changes from this chat/ });
  await expect(changes).toBeEnabled();
  await changes.click();
  await expect(page.locator('.map-cnt')).toHaveText(String(fixture.changedPaths.length));
  await expect(live(page)).toContainText('Files changed in this chat are lit up.');
  const dependents = page.getByRole('switch', { name: 'Include files that depend on them' });
  await expect(dependents).not.toBeChecked();
  await dependents.click();
  await expect(dependents).toBeChecked();
  await screenshot(page, 'changes-dark');
});

test('two projects show separate skies joined by labelled bridges and a likely path', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const webId = await addProject(page, path.join(REPO_ROOT, 'apps/web'));
  const serverId = await addProject(page, path.join(REPO_ROOT, 'apps/server'));
  await openMap(page, combinedFixture(webId, serverId), 'light', [webId]);
  await page.getByRole('button', { name: /^Projects on the map/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /^server/ }).click();
  await page.keyboard.press('Escape');
  await expect(sky(page)).toHaveAccessibleName(/Combined map of web and server/);
  await expect(page.getByRole('button', { name: /^HTTP API/ })).toContainText(/\d+/);
  const unmatched = page.getByRole('region', { name: 'Unmatched' });
  await expect(unmatched).toContainText('Routes nobody calls');
  await expect(unmatched.getByText('Possibly unused').first()).toBeVisible();
  await expect(unmatched.getByText(/^Unused$/)).toBeVisible();
  await screenshot(page, 'combined-light');
  const links = page.getByRole('list', { name: 'Links between projects' });
  const busiest = links.getByRole('button').first();
  await busiest.focus();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('Called from');
  await expect(tip).toContainText('Handled in');
  await expect(tip).toContainText('Click to trace the likely path');
  await busiest.press('Enter');
  const card = page.getByRole('navigation', { name: 'Likely path' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button')).not.toHaveCount(0);
  await expect(unmatched).toHaveCount(0);
  await screenshot(page, 'combined-path-light');
  await card.getByRole('button', { name: 'Clear path' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: /^HTTP API/ }).click();
  await expect(page.getByRole('button', { name: /^HTTP API/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('on a phone the map opens as a list of areas, with the sky one tap away', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const projectId = await addProject(page, REPO_ROOT);
  await openMap(page, monoFixture(projectId));
  const areas = page.getByRole('list', { name: 'Areas' });
  await expect(areas).toBeVisible();
  await expect(sky(page)).toHaveCount(0);
  await areas.getByRole('button', { name: /^Tickets/ }).click();
  const files = page.getByRole('list', { name: 'Files in Tickets' });
  await expect(files.getByRole('button').first()).toBeVisible();
  await screenshot(page, 'phone-list-dark');
  await files.getByRole('button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close file details' }).click();
  await page.getByRole('button', { name: 'Back to all areas' }).click();
  await page.getByRole('radio', { name: 'Sky' }).click();
  await expect(sky(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

async function canvasFrames(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('.map-sky')!;
    const first = canvas.toDataURL();
    await new Promise((resolve) => setTimeout(resolve, 600));
    return first === canvas.toDataURL();
  });
}

test('with reduced motion the sky holds still, even with changes lit', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await page.getByRole('switch', { name: /Show changes from this chat/ }).click();
  await expect(page.locator('.map-cnt')).toHaveText(String(fixture.changedPaths.length));
  await page.waitForTimeout(500);
  expect(await canvasFrames(page)).toBe(true);
  await sky(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.map-crumb')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await canvasFrames(page)).toBe(true);
});

test('the first build fills a skeleton sky that lights up area by area', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  const fixture = monoFixture(projectId);
  const ready = fixture.projects.get(projectId)!;
  const saved = { status: ready.status, areas: ready.areas };
  ready.status = {
    ...ready.status,
    status: 'building',
    phase: 'graph',
    progress: { done: 600, total: 1569 },
  };
  ready.areas = [];
  await openMap(page, fixture);
  const say = page.getByRole('status').filter({ hasText: 'I’m reading your project' });
  await expect(say).toContainText('600 of 1,569 files');
  await expect(page.getByRole('status').filter({ hasText: 'Building the map' })).toBeVisible();
  await screenshot(page, 'first-build-dark');
  ready.status = saved.status;
  ready.areas = saved.areas;
  await expect(
    page.getByRole('status').filter({ hasText: /Charted|All 21 areas are on the map/ }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole('status').filter({ hasText: 'All 21 areas are on the map' }),
  ).toBeVisible({
    timeout: 15_000,
  });
});
