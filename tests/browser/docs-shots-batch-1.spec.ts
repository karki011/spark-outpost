import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandSection } from './provider-screen.ts';
import { expect, test, type Page } from '@playwright/test';
import { repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { connectorCard, connectorHead } from './connector-cards.ts';
import {
  card,
  failingCheck,
  pickerPanel,
  pickPermission,
  send,
  type Level,
} from './crew-engine.ts';
import {
  DEMO_PROJECT,
  demoRepo,
  seedDemo,
  shoot,
  useSystemTheme,
  type DemoRepo,
} from './docs-seed.ts';
import { openChats } from './navigation.ts';
import { seedPrFollowUp } from './pr-follow-up-seed.ts';
import { FAKE_GH_STATE, STUB_PORT } from './stub-config.ts';
import { seedFlowChats } from './ticket-flow-seed.ts';
import { connectTickets, openTickets, resetTicketFakes } from './ticket-seed.ts';

const PLAN_APPROVAL = { kind: 'plan', title: 'Approve the plan' };

const IMAGES = path.resolve('docs/guide/images');
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

test.skip(!process.env.SPARK_DOCS_SHOTS, 'Run pnpm docs:screenshots to write the guide images.');

let repo: DemoRepo;

test.beforeEach(async ({ page }) => {
  repo = demoRepo();
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(() => {
  repo.remove();
  rmSync(FAKE_GH_STATE, { force: true });
});

async function openSettings(page: Page, tab?: RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Spark' })).toBeVisible();
  if (tab) await page.getByRole('tab', { name: tab }).click();
}

async function newChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByText('What should we work on?')).toBeVisible();
}

async function projectChat(page: Page, level: Level) {
  await newChat(page);
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${DEMO_PROJECT}`) }).click();
  await expect(menu.getByRole('list', { name: 'Linked repos' })).toContainText(DEMO_PROJECT);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickerPanel(page).getByRole('radio', { name: /^Auto/ }).click();
  await pickPermission(page, level);
  await page.keyboard.press('Escape');
}

function git(...args: string[]) {
  execFileSync('git', [
    '-C',
    repo.root,
    '-c',
    'user.email=maya@acme.test',
    '-c',
    'user.name=Maya',
    ...args,
  ]);
}

function crewFiles(relative: string, text: string) {
  writeFileSync(path.join(repo.root, relative), text);
  git('rm', '-q', 'package.json');
  git('add', relative);
  git('commit', '-qm', `Add ${relative}`);
}

test('Providers, models and Jev screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await seedDemo(page, repo);
  await openSettings(page, /AI providers/);
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const tiles = providers.locator('.ptiles-view');
  await expect(tiles.locator('.ptile[data-prov="claude"]')).toContainText('Connected');
  await shoot(page, IMAGES, 'providers-tiles', tiles);

  await providers.locator('.ptile[data-prov="claude"]').click();
  const claude = providers.locator('.pconf[data-prov="claude"]');
  await expandSection(claude, 'Defaults for new chats');
  const defaults = claude.getByRole('region', { name: 'Defaults for new chats' });
  await expect(defaults).toBeVisible();
  await shoot(page, IMAGES, 'providers-defaults', defaults);
  await claude.getByRole('button', { name: 'Back to AI providers' }).click();

  await providers.locator('.ptile[data-prov="jev"]').click();
  const jev = providers.locator('.pconf[data-prov="jev"]');
  await expandSection(jev, 'Settings');
  const advisor = jev.getByRole('region', { name: 'Settings' });
  await expect(advisor).toContainText('Sends');
  await shoot(page, IMAGES, 'jev-advisor', advisor);

  await page.getByRole('tab', { name: /^Models/ }).click();
  const models = page.getByRole('dialog', { name: 'Models' });
  await expect(models.locator('.mc-provider').first()).toBeVisible();
  await shoot(page, IMAGES, 'providers-model-cards');
  await page.keyboard.press('Escape');

  await newChat(page);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const auto = pickerPanel(page).getByRole('radio', { name: /^Auto/ });
  await auto.click();
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await shoot(page, IMAGES, 'auto-routing-picker');
});

async function sendAndWait(page: Page, text: string, turns: number) {
  await send(page, text);
  await expect(page.locator('.mood', { hasText: 'done' })).toHaveCount(turns, { timeout: 20_000 });
}

test('Compaction screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await seedDemo(page, repo);
  const askFirst = await page.request.patch('/api/profile', { data: { autoCompact: false } });
  expect(askFirst.ok()).toBe(true);
  await newChat(page);
  await sendAndWait(page, 'Plan the invoice export rollout #ctx75', 1);
  await page.getByRole('button', { name: /Context window: 75% used/ }).click();
  await expect(page.getByRole('dialog', { name: 'Context window' })).toContainText('Getting full');
  await shoot(page, IMAGES, 'compaction-ring');
  await page.keyboard.press('Escape');

  await sendAndWait(page, 'Go deeper on the CSV format #ctx90', 2);
  await send(page, 'What is next?');
  const full = card(page, /This chat is almost full/);
  await expect(full).toBeVisible({ timeout: 20_000 });
  await shoot(page, IMAGES, 'compaction-card', full);
  await full.getByRole('button', { name: 'Compact now' }).click();
  await expect(page.locator('.mood', { hasText: 'done' })).toHaveCount(3, { timeout: 20_000 });
  const divider = page.getByRole('group', { name: 'Compacted' });
  await divider.getByRole('button', { name: 'View summary' }).click();
  await expect(divider.getByRole('button', { name: 'Hide summary' })).toBeVisible();
  await shoot(page, IMAGES, 'compaction-divider', divider);

  const compactOn = await page.request.patch('/api/profile', { data: { autoCompact: true } });
  expect(compactOn.ok()).toBe(true);
  await openSettings(page);
  const section = page.getByRole('region', { name: 'Context compaction' });
  await section.scrollIntoViewIfNeeded();
  await shoot(page, IMAGES, 'compaction-settings', section);
});

const TOTALS = `export function sumTotals(rows: number[]): number {
  return rows.reduce((sum, row) => sum + row, 0);
}

export function helperTotals(rows: number[]): number {
  return rows.length;
}
`;

test('Crew, plan and guardrail screenshots', async ({ page }) => {
  test.setTimeout(150_000);
  crewFiles('src/totals.ts', TOTALS);
  await seedDemo(page, repo);
  await page.setViewportSize({ width: 1400, height: 900 });

  await projectChat(page, 'Auto-edit');
  await send(page, 'Rename the invoices table column and migrate old rows #build');
  const plan = card(page, /Build this plan\?/);
  await expect(plan.locator('.ck-estimate')).toBeVisible({ timeout: 30_000 });
  await shoot(page, IMAGES, 'spark-crew-plan', plan);
  await shoot(page, IMAGES, 'guardrails-estimate', plan);
  await plan.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });

  await projectChat(page, 'Auto-edit');
  await failingCheck(page, repo.root);
  await send(page, 'Fix the totals divider #build #removehelper #criticremoval');
  const keep = card(page, /Keep these changes\?/);
  await expect(keep.getByRole('list', { name: 'Worth a look' })).toBeVisible({ timeout: 30_000 });
  await expect(keep).toContainText('Kept automatically');
  await keep.scrollIntoViewIfNeeded();
  await shoot(page, IMAGES, 'prompt-flow-crew-turn');
  await shoot(page, IMAGES, 'guardrails-keep-card', keep);
});

test('Ship screenshot', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-docs-ship-')));
  try {
    await page.request.post(`${STUB_URL}/github-test/reset`);
    await seedDemo(page, repo);
    const remote = await repoWithRemote(base, 'acme-shop');
    writeFileSync(FAKE_GH_STATE, 'maya');
    const response = await page.request.post('/api/projects', { data: { rootPath: remote.root } });
    expect(response.ok()).toBe(true);
    await newChat(page);
    await page.locator('.ctx-repo').click();
    const menu = page.getByRole('dialog', { name: 'Project folders' });
    await menu.getByRole('button', { name: /^acme-shop/ }).click();
    await expect(menu.getByRole('list', { name: 'Linked repos' })).toContainText('acme-shop');
    await page.keyboard.press('Escape');
    await pickPermission(page, 'Ask before edits');
    await page.keyboard.press('Escape');
    await send(page, 'Add a line to the notes #edit #plan');
    await card(page, /Change a file\?/)
      .getByRole('button', { name: 'Allow', exact: true })
      .click();
    await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 15_000 });
    await page.locator('.ship-btn').click();
    const panel = page.getByRole('group', { name: 'Ship this task' });
    await panel.getByLabel('Pull request title').fill('Add a line to the release notes');
    await shoot(page, IMAGES, 'ship-panel', panel);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('PR follow-up screenshots', async ({ page }) => {
  await seedDemo(page, repo);
  await seedPrFollowUp();
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('listitem')
    .filter({ hasText: 'Fix the cents parser' })
    .first()
    .click();
  const strip = page.getByRole('region', { name: 'Pull request acme/widgets#7' });
  await strip.getByText('3 items gathered').click();
  await expect(strip.getByRole('listitem').filter({ hasText: 'F3' })).toBeVisible();
  await shoot(page, IMAGES, 'pr-follow-up-strip', strip);
  const confirm = page.getByRole('group', { name: /Address PR feedback\?/ });
  await expect(confirm).toBeVisible();
  await shoot(page, IMAGES, 'pr-follow-up-card', confirm);
});

test('Tickets and GitHub screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await resetTicketFakes();
  await page.request.post(`${STUB_URL}/github-test/reset`);
  await seedDemo(page, repo);
  writeFileSync(FAKE_GH_STATE, 'maya');
  await openSettings(page, /Connectors/);
  const github = connectorCard(page, 'github');
  await connectorHead(github).click();
  await expect(github).toContainText('maya');
  await shoot(page, IMAGES, 'tickets-github', github);

  await connectTickets(page);
  await page.request.get('/api/tickets/inbox');
  await seedFlowChats([
    { key: 'WEB-421', source: 'linear', status: 'awaiting_approval', approval: PLAN_APPROVAL },
    {
      key: 'WEB-433',
      source: 'linear',
      status: 'running',
      spark: 'Pip',
      plan: ['completed', 'completed', 'in_progress'],
    },
    { key: 'API-84', source: 'jira', status: 'succeeded' },
    {
      key: 'API-77',
      source: 'jira',
      status: 'succeeded',
      pull: { number: 341, checks: 'passing' },
    },
  ]);
  await openTickets(page);
  const main = page.getByRole('main', { name: 'Tickets' });
  await expect(main.getByRole('region', { name: 'Needs you', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await shoot(page, IMAGES, 'tickets-inbox');

  await main.locator('li[data-ticket$=":ENG-1210"]').hover();
  await page.getByRole('button', { name: 'Start ENG-1210' }).click();
  const start = page.getByRole('dialog', { name: 'Start work on ENG-1210' });
  await expect(start.getByRole('radio', { name: 'Plan first' })).toBeFocused();
  await shoot(page, IMAGES, 'tickets-start', start);
});
