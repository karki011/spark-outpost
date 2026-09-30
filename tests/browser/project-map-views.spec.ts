import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { combinedFixture, monoFixture, REPO_ROOT } from './map-fixture.ts';
import { nxFixture } from './map-nx-fixture.ts';
import { addProject, openMap, outline, screenshot, sky, tree } from './map-page.ts';
import { seedChats } from './sidebar-seed.ts';

test.beforeEach(async () => {
  test.setTimeout(90_000);
  await resetTestDatabase({ onboarded: true });
});

const node = (page: Page, name: RegExp) => tree(page).getByRole('button', { name });
const focused = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
const skin = (page: Page, name: string) =>
  page.evaluate((value) => (document.documentElement.dataset.skin = value), name);

async function lightChatChanges(page: Page, projectId: string, paths: string[]) {
  await seedChats([
    { title: 'Tidy the orders', projectIds: [projectId], run: { status: 'succeeded' } },
  ]);
  await page.route(/\/api\/runs\/[^/]+\/changes$/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        revertible: true,
        revertedAt: null,
        reason: null,
        files: paths.map((path) => ({ path, change: 'modified' })),
      }),
    }),
  );
}

test('the tree is the default view: top-level groups that open into areas and files', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  const fixture = nxFixture(projectId);
  await lightChatChanges(page, projectId, fixture.changedPaths);
  await openMap(page, fixture, 'light', undefined, { view: null, tips: true });
  await expect(tree(page)).toHaveAccessibleName(/^Tree of .*: 30 groups, 265 areas\./);
  await expect(page.getByRole('radio', { name: 'Tree' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('complementary', { name: 'Tree view tip' })).toContainText(
    'Click a group to open it',
  );
  const ui = node(page, /^ui, group of 20 areas/);
  await expect(ui).toBeVisible();
  await expect(ui).toContainText('Shared');
  await expect(node(page, /^core, group of 5 areas/)).toContainText('Core');
  expect(await page.locator('.react-flow__edge').count()).toBeGreaterThan(10);
  await page.getByRole('switch', { name: /This chat’s changes/ }).click();
  await expect(page.locator('.map-tn-changed').first()).toBeVisible();
  await screenshot(page, 'map-view-tree-light');
  await skin(page, 'graphite');
  await screenshot(page, 'map-view-tree-dark');
  await skin(page, 'light');

  await ui.click();
  await expect(
    tree(page).getByRole('button', { name: /^ui, group .*Press Escape to close/ }),
  ).toBeVisible();
  const area = node(page, /^[a-z-]+, area, \d+ files/).first();
  await expect(area).toBeVisible();
  await area.click();
  await expect(
    tree(page)
      .locator('.react-flow__node-file [role="button"], .react-flow__node-folder [role="button"]')
      .first(),
  ).toBeVisible({ timeout: 15_000 });
  await screenshot(page, 'map-view-tree-open-light');
  const file = tree(page).locator('.react-flow__node-file [role="button"]').first();
  await file.click();
  await expect(page.getByRole('dialog', { name: /\.(tsx?|md)$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close file details' }).click();

  await page.getByRole('button', { name: 'Close all' }).click();
  await expect(node(page, /^ui, group of 20 areas/)).toBeVisible();
});

test('arrow keys walk the tree, Enter opens, Escape closes, links strength is adjustable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  await openMap(page, nxFixture(projectId), 'graphite', undefined, { view: 'tree' });
  await expect(tree(page)).toBeVisible();
  const first = tree(page).locator('[data-tree-node][tabindex="0"]');
  await expect(first).toHaveCount(1);
  await first.focus();
  const start = await focused(page);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).not.toBe(start);
  await page.keyboard.press('ArrowRight');
  const group = await focused(page);
  expect(group).toMatch(/Press Enter to open/);
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toMatch(/Press Escape to close/);
  await expect(page.locator('.map-stage [aria-live="polite"]').first()).toContainText('opened');
  await page.keyboard.press('Escape');
  await expect.poll(() => focused(page)).toMatch(/Press Enter to open/);

  const strong = await page.locator('.react-flow__edge').count();
  await page.getByRole('radio', { name: 'All' }).click();
  await expect.poll(() => page.locator('.react-flow__edge').count()).toBeGreaterThan(strong);
});

test('search reveals a file in the tree and Focus shows what breaks if it changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  await openMap(page, monoFixture(projectId), 'light', undefined, { view: 'tree' });
  await expect(tree(page)).toBeVisible();
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: 'Find a file on the map' }).fill('ticket-model.ts');
  await page
    .getByRole('option', { name: /ticket-model\.ts/ })
    .first()
    .click();
  await expect
    .poll(() => focused(page), { timeout: 15_000 })
    .toMatch(/^apps\/web\/src\/tickets\/ticket-model\.ts/);
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'ticket-model.ts' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Focus' }).click();

  await expect(page.getByRole('radio', { name: 'Focus' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('heading', { name: 'ticket-model.ts' })).toBeVisible();
  const impact = page.getByRole('region', { name: 'What breaks if I change this?' });
  await expect(impact).toContainText(/depends? on this|Nothing on the map depends/);
  await expect(page.getByRole('region', { name: /^Imported by/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Imports/ })).toBeVisible();
  await screenshot(page, 'map-view-focus-light');
  await page.getByRole('radio', { name: '2 hops' }).click();
  await expect(impact).toBeVisible();
  const neighbour = page
    .getByRole('region', { name: /^Imported by|^Imports/ })
    .getByRole('button')
    .first();
  if ((await neighbour.count()) > 0) {
    const label = (await neighbour.getAttribute('aria-label')) ?? '';
    await neighbour.click();
    const name = label.split(',')[0]!.split('.')[0]!.split('/').pop()!;
    await expect(
      page.getByRole('heading', { level: 2, name: new RegExp(`^${name}`) }),
    ).toBeVisible();
  }
  await skin(page, 'graphite');
  await screenshot(page, 'map-view-focus-dark');
});

test('Focus without a file suggests the busiest ones; views and tips are remembered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const projectId = await addProject(page, REPO_ROOT);
  await openMap(page, nxFixture(projectId), 'graphite', undefined, { view: null, tips: true });
  await expect(tree(page)).toBeVisible();
  await page.getByRole('radio', { name: 'Focus' }).click();
  await expect(page.getByRole('heading', { name: 'Pick a file to focus on' })).toBeVisible();
  const tip = page.getByRole('complementary', { name: 'Focus view tip' });
  await expect(tip).toContainText('Focus shows what breaks if you change a file');
  await tip.getByRole('button', { name: 'Dismiss tip' }).click();
  await expect(tip).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('spark-outpost.map-tips'))).toContain(
    'focus',
  );
  await page.getByRole('list', { name: 'Suggested files' }).getByRole('button').first().click();
  const impact = page.getByRole('region', { name: 'What breaks if I change this?' });
  await expect(impact).toContainText(/depends? on this/);
  await expect(impact).toContainText(/Core areas affected: core/);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Focus' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('heading', { name: 'Pick a file to focus on' })).toBeVisible();
});

test('the outline lists groups, areas and files, sorts them and only renders what is visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await addProject(page, REPO_ROOT);
  await openMap(page, nxFixture(projectId), 'light', undefined, { view: 'outline' });
  const list = outline(page);
  await expect(list).toBeVisible();
  await expect(list.getByRole('treeitem').first()).toHaveAttribute('aria-level', '1');
  await page.getByRole('radio', { name: 'Name' }).click();
  await expect(list.getByRole('treeitem').first()).toHaveAccessibleName(/^accounts,/);
  await page.getByRole('radio', { name: 'Size' }).click();
  await expect(list.getByRole('treeitem').first()).toHaveAccessibleName(/^ui,/);
  const ui = list.getByRole('treeitem', { name: /^ui,/ });
  await ui.focus();
  await page.keyboard.press('ArrowRight');
  await expect(ui).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => list.locator('[role="treeitem"][aria-level="3"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(5);
  await screenshot(page, 'map-view-outline-light');
  await skin(page, 'graphite');
  await screenshot(page, 'map-view-outline-dark');
  const rendered = await list.getByRole('treeitem').count();
  const total =
    Number(await list.evaluate((element) => element.getBoundingClientRect().height)) / 40;
  expect(total).toBeGreaterThan(rendered);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => focused(page)).not.toBe('');
});

test('two projects sit side by side in the tree with links between them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const web = await addProject(page, `${REPO_ROOT}/apps/web`);
  const server = await addProject(page, `${REPO_ROOT}/apps/server`);
  await openMap(page, combinedFixture(web, server), 'graphite', [web, server], { view: 'tree' });
  await expect(tree(page)).toBeVisible();
  const frames = page.locator('.react-flow__node-project');
  await expect(frames).toHaveCount(2);
  const [left, right] = await Promise.all([
    frames.nth(0).boundingBox(),
    frames.nth(1).boundingBox(),
  ]);
  expect(Math.abs(left!.y - right!.y)).toBeLessThan(2);
  await expect.poll(() => page.locator('.react-flow__edge.bridge').count()).toBeGreaterThan(0);
  await screenshot(page, 'map-view-tree-combined-dark');
  await page.getByRole('radio', { name: 'Sky' }).click();
  await expect(sky(page)).toHaveAccessibleName(/Combined map of/);
  await screenshot(page, 'map-view-sky-dark');
  await skin(page, 'light');
  await screenshot(page, 'map-view-sky-light');
});
