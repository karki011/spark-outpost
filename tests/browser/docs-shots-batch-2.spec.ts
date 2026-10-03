import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DEMO_PROJECT,
  demoRepo,
  seedDemo,
  shoot,
  useSystemTheme,
  type DemoRepo,
} from './docs-seed.ts';
import { monoFixture } from './map-fixture.ts';
import { openMap, tree } from './map-page.ts';
import { openChats } from './navigation.ts';
import { connectTickets, resetTicketFakes } from './ticket-seed.ts';

const IMAGES = path.resolve('docs/guide/images');

test.skip(!process.env.SPARK_DOCS_SHOTS, 'Run pnpm docs:screenshots to write the guide images.');

let repo: DemoRepo;

test.beforeEach(async ({ page }) => {
  repo = demoRepo();
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(() => repo.remove());

async function demoProjectId(page: Page): Promise<string> {
  const response = await page.request.get('/api/projects');
  const projects = (await response.json()) as { id: string; name: string }[];
  return projects.find((project) => project.name === DEMO_PROJECT)!.id;
}

async function newDemoChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${DEMO_PROJECT}`) }).click();
  await page.keyboard.press('Escape');
}

test('Map screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedDemo(page, repo);
  const projectId = await demoProjectId(page);
  await openMap(page, monoFixture(projectId), 'system', [projectId], { view: 'tree' });
  await expect(tree(page)).toBeVisible();
  await page.waitForTimeout(1500);
  await shoot(page, IMAGES, 'map-tree');

  await page.getByRole('radio', { name: 'Focus' }).click();
  const suggested = page.getByRole('list', { name: 'Suggested files' });
  await suggested.getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'What breaks if I change this?' })).toBeVisible();
  await page.waitForTimeout(800);
  await shoot(page, IMAGES, 'map-focus');
});

const dock = (page: Page) => page.getByRole('region', { name: 'Terminal' });

async function typeInTerminal(page: Page, command: string) {
  await expect(dock(page).locator('.term-light.open').last()).toBeVisible();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

async function terminalShots(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await newDemoChat(page);
  await page.locator('.head-r').getByRole('button', { name: 'Terminal' }).click();
  const tabs = dock(page).getByRole('group', { name: 'Terminals' });
  const first = tabs.getByRole('button', { name: `my files · ${DEMO_PROJECT}`, exact: true });
  await expect(first).toBeVisible();
  await typeInTerminal(page, "PS1='acme-web $ '; clear");
  await typeInTerminal(page, 'git status --short --branch');
  await expect(dock(page).locator('.xterm-accessibility')).toContainText('## main');
  await dock(page).getByRole('button', { name: 'New terminal' }).click();
  await expect(
    tabs.getByRole('button', { name: `my files · ${DEMO_PROJECT} (2)`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await typeInTerminal(page, "PS1='acme-web $ '; clear; sleep 300");
  await page.waitForTimeout(1500);
  await first.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(IMAGES, `terminals-dock-${scheme}.png`) });

  await tabs.getByRole('button', { name: `Close my files · ${DEMO_PROJECT} (2)` }).click();
  const confirm = dock(page).getByRole('group', { name: 'Stop sleep 300?' });
  await expect(confirm).toBeVisible();
  await page.waitForTimeout(400);
  await dock(page).screenshot({ path: path.join(IMAGES, `terminals-stop-${scheme}.png`) });
  await confirm.getByRole('button', { name: 'Keep running' }).click();
}

test('Terminal screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await seedDemo(page, repo);
  await terminalShots(page, 'light');
  await terminalShots(page, 'dark');
});

test('Spark tools screenshots', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await seedDemo(page, repo);
  await resetTicketFakes();
  await connectTickets(page, ['linear']);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(
    '#build #spark spark_create_ticket {"project":"ENG","title":"Invoice CSV export drops the currency","priority":"high"}',
  );
  await input.press('Enter');
  const card = page.getByRole('group', { name: /Create this ticket\?/ });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card).toContainText('Nothing happens until you confirm');
  await shoot(page, IMAGES, 'spark-tools-action-card', card);
  await card.getByRole('button', { name: 'Don’t' }).click();
});
