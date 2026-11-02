import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { openTouch } from './responsive-kit.ts';

const SHOTS = process.env.TERMINAL_SCREENSHOTS ?? '';
const PASS = 'pnpm test --filter web';
const FAIL = 'pnpm lint';
const FAKE_SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function ask(page: Page, message: string) {
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(message);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await input.press('Enter');
}

async function askInChats(page: Page, message: string) {
  await openChats(page);
  await ask(page, message);
}

const terminal = (page: Page, command: string) =>
  page.getByRole('region', { name: `Command: ${command}` });

const toggle = (box: Locator) => box.locator('.run-cmd-toggle');
const state = (box: Locator) => box.locator('.run-cmd-state');
const rows = (box: Locator) => box.locator('.xterm-rows');
const done = (page: Page) => page.locator('.md', { hasText: 'terminal=done' });

async function unfold(box: Locator) {
  await expect(toggle(box)).toHaveAttribute('aria-expanded', 'false', { timeout: 5_000 });
  await toggle(box).click();
}

test('shows a running command as one row, then passed, with its output on unfold', async ({
  page,
}) => {
  await askInChats(page, 'Run the tests #terminal=pass 400ms');
  const box = terminal(page, PASS);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await expect(toggle(box)).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle(box)).toContainText('Running');
  await expect(box.locator('.spin')).toBeVisible();
  await expect(box.locator('.run-cmd-cwd')).toHaveCount(0);
  await expect(page.locator('.md', { hasText: 'Finished pass.' })).toHaveCount(0);
  await shot(page, 'running');

  await expect(state(box)).toHaveText(/passed · \d+s/, { timeout: 15_000 });
  await expect(toggle(box)).toContainText('Ran');
  await expect(toggle(box)).toHaveAttribute('aria-expanded', 'false');
  await expect(box.locator('.xterm')).toHaveCount(0);
  await expect(done(page)).toBeVisible();
  await unfold(box);
  await expect(rows(box)).toContainText('Tests 23 passed');
  await shot(page, 'finished');

  const order = await page
    .locator('.msg.ai')
    .last()
    .evaluate((turn) =>
      [...turn.querySelectorAll('.md, .run-cmd')].map((node) =>
        node.classList.contains('run-cmd') ? 'terminal' : node.textContent!.trim().slice(0, 14),
      ),
    );
  expect(order).toEqual(['Running the co', 'terminal', 'Finished pass.']);
});

test('keeps a failed command open, and expands, collapses and copies by keyboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await askInChats(page, 'Lint it #terminal=fail,pass 30ms');
  await expect(done(page)).toBeVisible({ timeout: 20_000 });
  const failed = terminal(page, FAIL);
  await expect(state(failed)).toHaveText(/failed · exit 1 · \d+s/);
  await page.waitForTimeout(2_200);
  await expect(toggle(failed)).toHaveAttribute('aria-expanded', 'true');
  await expect(rows(failed)).toContainText('1 problem (1 error, 0 warnings)');
  await expect(toggle(terminal(page, PASS))).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.xterm')).toHaveCount(1);
  await shot(page, 'failed');

  const short = (await failed.locator('.run-cmd-screen').boundingBox())!.height;
  const taller = failed.getByRole('button', { name: 'Taller output' });
  await taller.focus();
  await page.keyboard.press('Enter');
  await expect(taller).toHaveAttribute('aria-pressed', 'true');
  expect((await failed.locator('.run-cmd-screen').boundingBox())!.height).toBeGreaterThan(
    short * 2,
  );
  await shot(page, 'expanded');

  await failed.getByRole('button', { name: 'Copy output' }).click();
  await expect(failed.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("12:7  error  'unused' is assigned a value but never used");
  expect(copied).not.toContain('\u001b');

  await toggle(failed).focus();
  await page.keyboard.press('Enter');
  await expect(toggle(failed)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.xterm')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(rows(failed)).toContainText('1 problem');
});

test('shows stored output after a reload and the reader text without colour codes', async ({
  page,
}) => {
  await askInChats(page, 'Reload check #terminal=pass,fail 20ms');
  await expect(done(page)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Reload check').click();
  const passed = terminal(page, PASS);
  const failed = terminal(page, FAIL);
  await expect(toggle(passed)).toHaveAttribute('aria-expanded', 'false');
  await expect(state(passed)).toHaveText(/passed/);
  await expect(toggle(failed)).toHaveAttribute('aria-expanded', 'true');
  await expect(rows(failed)).toContainText('1 problem (1 error, 0 warnings)');
  await unfold(passed);
  await expect(rows(passed)).toContainText('Tests 23 passed');
  await expect(passed.locator('pre.sr-only')).toContainText('✓ src/chat/turns.test.ts (4 tests)');
  await expect(page.locator('.run-cmd')).toHaveCount(2);
  await expect(passed.getByRole('status')).toHaveText('Finished, exit code 0');
});

test('strips unsafe sequences and secrets before output reaches the page', async ({ page }) => {
  await askInChats(page, 'Safety #terminal=osc,secret 20ms');
  await expect(done(page)).toBeVisible({ timeout: 20_000 });
  await expect(page).not.toHaveTitle(/owned/);
  const banner = terminal(page, 'cat banner.txt');
  await unfold(banner);
  await expect(rows(banner)).toContainText('banner shown');
  await expect(banner.locator('a')).toHaveCount(0);
  const env = terminal(page, 'printenv');
  await unfold(env);
  await expect(rows(env)).toContainText('GITHUB_TOKEN=[redacted');
  await expect(page.locator('body')).not.toContainText(FAKE_SECRET);
  await expect(env.locator('pre.sr-only')).toContainText('HOME=/Users/demo');
});

test('a very long output stays capped and the chat stays usable', async ({ page }) => {
  await askInChats(page, 'Noisy #terminal=huge 5ms');
  const box = terminal(page, 'seq 40000');
  await unfold(box);
  await expect(rows(box)).toContainText(/row \d+/, { timeout: 15_000 });
  await expect(done(page)).toBeVisible({ timeout: 30_000 });
  await expect(rows(box)).toContainText('row 39999');
  await expect(box.locator('.run-cmd-note')).toHaveText(/Showing the last \d+ KB of [\d,]+ KB\./);
  const kept = await box.locator('.xterm-rows > div').count();
  expect(kept).toBeLessThan(60);
});

test('says when an agent only reports output at the end', async ({ page }) => {
  await askInChats(page, 'End only #terminal=final 300ms');
  const box = terminal(page, 'git status --short');
  await unfold(box);
  await expect(box.locator('.run-cmd-note')).toHaveText('Output shows when the command ends.', {
    timeout: 15_000,
  });
  await expect(box.locator('.xterm')).toHaveCount(0);
  await expect(state(box)).toHaveText(/passed · \d+s/, { timeout: 15_000 });
  await expect(rows(box)).toContainText('?? notes.txt');
});

test('marks a command that was running when the turn stopped as interrupted', async ({ page }) => {
  await askInChats(page, 'Dev server #terminal=hang 20ms');
  const box = terminal(page, 'pnpm dev');
  await unfold(box);
  await expect(rows(box)).toContainText('ready on http://localhost:5173', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(state(box)).toHaveText('interrupted', { timeout: 15_000 });
  await expect(toggle(box)).toHaveAttribute('aria-expanded', 'true');
  await expect(box.locator('.run-cmd-note')).toHaveText(
    'Interrupted before it finished. This is what was captured.',
  );
  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Dev server').click();
  await expect(state(terminal(page, 'pnpm dev'))).toHaveText('interrupted');
  await expect(rows(terminal(page, 'pnpm dev'))).toContainText('ready on http://localhost:5173');
});

test('at phone width the output scrolls sideways inside its box with large controls', async ({
  page: desktop,
  browser,
}) => {
  await askInChats(desktop, 'Phone #terminal=fail 30ms');
  await expect(done(desktop)).toBeVisible({ timeout: 20_000 });
  const page = await openTouch(browser, { width: 390, height: 844 }, 'chats');
  const box = terminal(page, FAIL);
  await expect(rows(box)).toContainText('1 problem', { timeout: 20_000 });
  const sizes = await box.evaluate((node) => {
    const screen = node.querySelector('.run-cmd-screen')!;
    const buttons = [...node.querySelectorAll('button')].map((button) => {
      const hit = button.getBoundingClientRect();
      const before = getComputedStyle(button, '::before');
      return Math.max(hit.height, Number.parseFloat(before.height) || 0);
    });
    return {
      box: node.getBoundingClientRect().width,
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      scrollable: screen.scrollWidth > screen.clientWidth,
      smallestControl: Math.min(...buttons),
    };
  });
  expect(sizes.box).toBeLessThanOrEqual(390);
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.scrollable).toBe(true);
  expect(sizes.smallestControl).toBeGreaterThanOrEqual(44);
  await shot(page, 'phone');
  await page.context().close();
});

const WHOAMI = 'aws sts get-caller-identity --query Arn --output text';
const COUNT =
  'python -m scripts.run_query --format json --sql "SELECT org_id, count(*) FROM events"';

test('groups commands and thoughts into one line, titled by the agent, and opens a failure', async ({
  page,
}) => {
  await askInChats(page, 'Check live #steps=whoami,think,count,think,fetch 30ms');
  await expect(done(page)).toBeVisible({ timeout: 20_000 });
  const group = page.getByRole('button', { name: /^Ran 3 commands, thought 2 times/ });
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(group.locator('.trow-word')).toHaveText(['1 failed', '2 passed']);
  await expect(group.locator('.trow-word').first()).toHaveClass(/bad/);

  const checked = terminal(page, WHOAMI);
  await expect(toggle(checked)).toHaveText(/^Ran Check which account the profile uses/);
  await expect(toggle(checked)).not.toContainText('aws sts');
  await expect(toggle(checked)).toHaveAttribute('aria-expanded', 'false');
  const failed = terminal(page, COUNT);
  await expect(toggle(failed)).toHaveAttribute('aria-expanded', 'true');
  await expect(failed.locator('.run-cmd-cmd')).toHaveText(`$ ${COUNT}`);
  await expect(rows(failed)).toContainText('security token included in the request is expired');
  await expect(page.locator('.msg.ai .trow', { hasText: /^Thought/ })).toHaveCount(2);
  await expect(page.locator('.run-cmd-answer')).toHaveCount(0);

  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.run-cmd')).toHaveCount(0);
  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Check live').click();
  await expect(
    page.getByRole('button', { name: /^Ran 3 commands, thought 2 times/ }),
  ).toBeVisible();
});

for (const theme of ['light', 'graphite', 'contrast']) {
  test(`open and folded terminals have no serious accessibility issues in the ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript((saved) => localStorage.setItem('spark-outpost.theme', saved), theme);
    await askInChats(page, 'Check #terminal=fail,pass 20ms');
    await expect(done(page)).toBeVisible({ timeout: 20_000 });
    await expect(rows(terminal(page, FAIL))).toContainText('1 problem');
    await expect(toggle(terminal(page, PASS))).toHaveAttribute('aria-expanded', 'false', {
      timeout: 5_000,
    });
    const results = await new AxeBuilder({ page })
      .include('.run-cmd')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map(
        (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' ')}`,
      );
    expect(blocking).toEqual([]);
    await shot(page, `theme-${theme}`);
  });
}
