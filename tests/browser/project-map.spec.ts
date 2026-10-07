import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { combinedFixture, monoFixture, REPO_ROOT, serveMap } from './map-fixture.ts';
import { addProject, openMap, outline, screenshot, sky } from './map-page.ts';
import { seedChats } from './sidebar-seed.ts';
import { MAP_ROOT_PREFIX } from './stub-config.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

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
  await expect(page.getByRole('button', { name: /^Updated/ })).toHaveText('Updated 2 min ago');
  await expect(page.getByRole('button', { name: /^Core/ })).toHaveAttribute('aria-pressed', 'true');
  const kinds = page.getByRole('group', { name: 'File kind' });
  await expect(kinds.getByRole('button', { name: /^UI/ })).toHaveText(/^UI\s*[1-9][\d,]*$/);
  await expect(kinds.getByRole('button', { name: /^Tests/ })).toHaveText(/^Tests\s*[1-9][\d,]*$/);
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

test('arrows walk the areas, Enter opens one as a network and Escape goes back @packaged', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  await openMap(page, monoFixture(projectId));
  const loadedAreaSizes = new Set<number>();
  page.on('response', (response) => {
    if (!/\/map\/areas\//.test(response.url())) return;
    void response
      .json()
      .then((body: { nextOffset: number | null; files?: unknown[] }) => {
        if (body.nextOffset === null && Array.isArray(body.files)) {
          loadedAreaSizes.add(body.files.length);
        }
      })
      .catch(() => undefined);
  });
  await expect(sky(page)).toHaveAccessibleName(/21 areas/);
  await sky(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(live(page)).toContainText(/area, \d+ files\. Press Enter to open\./);
  const announced = (await live(page).textContent()) ?? '';
  const name = announced.split('.')[0]!;
  const areaFileCount = Number(/(\d+) files/.exec(announced)?.[1]);
  await page.keyboard.press('Enter');
  const crumb = page.locator('.map-crumb');
  await expect(crumb.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Area' })).toBeVisible();
  await expect.poll(() => loadedAreaSizes.has(areaFileCount), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(400);
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
  await expect(tip).toContainText(
    /Changed (today|yesterday|\d+ days ago|\w+ \d+) · \d+ commits? · \d+ authors?/,
  );
  await screenshot(page, 'hover-dark');
  await page.mouse.click(x, y);
  const sheet = page.getByRole('dialog', { name: 'ticket-model.ts' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Depended on by' })).toBeVisible();
  await expect(sheet).toContainText(/Changed .* · \d+ commits? · \d+ authors?/);
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
  const changes = page.getByRole('switch', { name: /This chat’s changes/ });
  await expect(changes).toBeEnabled();
  await changes.click();
  await expect(page.locator('.map-cnt')).toHaveText(String(fixture.changedPaths.length));
  await expect(live(page)).toContainText('Files changed in this chat are lit up.');
  const dependents = page.getByRole('switch', { name: 'Include dependents' });
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
  await screenshot(page, 'combined-light');
  const unmatched = page.getByRole('region', { name: 'Unmatched' });
  await expect(unmatched).toHaveCount(0);
  await page.getByRole('button', { name: /^Unmatched/ }).click();
  await expect(unmatched).toContainText('Routes nobody calls');
  await expect(unmatched.getByText('Possibly unused').first()).toBeVisible();
  await expect(unmatched.getByText(/^Unused ·/)).toBeVisible();
  await screenshot(page, 'combined-unmatched-light');
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

test('on a phone a saved Map view opens Home and the Map is not offered', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const projectId = await addProject(page, REPO_ROOT);
  await serveMap(page, monoFixture(projectId));
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'map'));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Start a new chat' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Map' })).toHaveCount(0);
  await nav.getByRole('button', { name: 'More' }).click();
  const more = page.getByRole('group', { name: 'More destinations' });
  await expect(more.getByRole('button', { name: 'Phone' })).toBeVisible();
  await expect(more.getByRole('button', { name: 'Map' })).toHaveCount(0);
  await expect(page.locator('.map-stage')).toHaveCount(0);
  await expect(outline(page)).toHaveCount(0);
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
  await page.getByRole('switch', { name: /This chat’s changes/ }).click();
  await expect(page.locator('.map-cnt')).toHaveText(String(fixture.changedPaths.length));
  await expect.poll(() => canvasFrames(page), { timeout: 15_000 }).toBe(true);
  await sky(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.map-crumb')).toBeVisible();
  await expect.poll(() => canvasFrames(page), { timeout: 15_000 }).toBe(true);
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
    phase: 'labels',
    progress: { done: 34, total: 268 },
    jevAreas: 268,
  };
  ready.areas = [];
  await openMap(page, fixture);
  await expect(page.getByText('Jev is labelling areas · 34 / 268')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jev labelling… 34/268' })).toBeVisible();
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

test('the real map builder fills the sky for a small repository', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1200, height: 800 });
  const root = mkdtempSync(MAP_ROOT_PREFIX);
  const files: Record<string, string> = {
    'package.json': '{ "name": "shop", "type": "module" }\n',
    'web/pages/Cart.tsx':
      "import { total } from '../lib/prices.ts';\nexport const Cart = () => total([1]);\n",
    'web/pages/Home.tsx': "import { Cart } from './Cart.tsx';\nexport const Home = () => Cart();\n",
    'web/lib/prices.ts':
      "import { round } from '../../shared/math.ts';\nexport const total = (xs: number[]) => round(xs.reduce((a, b) => a + b, 0));\n",
    'server/routes/cart.ts':
      "import { round } from '../../shared/math.ts';\nexport const cart = () => round(2);\n",
    'server/db/store.ts':
      "import { cart } from '../routes/cart.ts';\nexport const store = () => cart();\n",
    'shared/math.ts': 'export const round = (n: number) => Math.round(n);\n',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'base');
  try {
    await addProject(page, root);
    await page.addInitScript(() => {
      localStorage.setItem('spark-outpost.view', 'map');
      localStorage.setItem('spark-outpost.map-view', '"sky"');
      localStorage.setItem('spark-outpost.map-view', '"sky"');
    });
    await page.goto('/');
    await expect(sky(page)).toHaveAccessibleName(/[1-9]\d* areas as constellations/, {
      timeout: 100_000,
    });
    await expect(page.getByRole('button', { name: /^Updated/ })).toBeVisible();
    await sky(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('.map-crumb')).toBeVisible();
    await expect(async () => {
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tooltip')).toContainText(/on this/, { timeout: 1000 });
    }).toPass();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real builder lists routes nothing calls and calls with no route across two projects', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const repos = {
    web: {
      'package.json': '{ "name": "shop-web" }\n',
      'src/cart.ts':
        "export const cart = () => fetch('/api/cart');\nexport const gone = () => fetch('/api/missing');\n",
    },
    api: {
      'package.json': '{ "name": "shop-api" }\n',
      'src/app.ts': [
        "import express from 'express';",
        'const app = express();',
        "app.get('/api/cart', (req, res) => res.json([]));",
        "app.get('/api/unused', (req, res) => res.json([]));",
        'export default app;',
      ].join('\n'),
    },
  };
  const roots = Object.values(repos).map((files) => {
    const root = mkdtempSync(MAP_ROOT_PREFIX);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'base');
    return root;
  });
  try {
    const ids = [await addProject(page, roots[0]!), await addProject(page, roots[1]!)];
    await page.addInitScript((selected) => {
      localStorage.setItem('spark-outpost.view', 'map');
      localStorage.setItem('spark-outpost.map-view', '"sky"');
      localStorage.setItem('spark-outpost.map-projects', JSON.stringify(selected));
    }, ids);
    await page.goto('/');
    await expect(sky(page)).toHaveAccessibleName(/Combined map of/, { timeout: 100_000 });
    const chip = page.getByRole('button', { name: /^Unmatched/ });
    await expect(chip).toHaveText(/^Unmatched\s*2$/, { timeout: 100_000 });
    await chip.click();
    const panel = page.getByRole('region', { name: 'Unmatched' });
    await expect(
      panel.getByRole('button', { name: /^GET \/api\/unused Possibly unused/ }),
    ).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await expect(panel).not.toContainText('/api/cart');
    await panel.getByRole('radio', { name: /^Calls with no route/ }).click();
    await expect(panel).toContainText('/api/missing');
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
