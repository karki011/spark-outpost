import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { CloneJob } from '../../packages/contracts/src/project-clone.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { CLONE_TEST_ROOT, STUB_PORT } from './stub-config.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const DOCUMENTS = path.join(CLONE_TEST_ROOT, 'Documents');
const WIDGETS_URL = 'https://github.com/acme/widgets.git';
const PAT = 'ghp_browserCloneListingToken0123456789ab';
const JOB_ID = '0199b7a0-0000-7000-8000-000000000001';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

function seedSource() {
  rmSync(CLONE_TEST_ROOT, { recursive: true, force: true });
  const work = path.join(CLONE_TEST_ROOT, 'work');
  mkdirSync(path.join(DOCUMENTS, 'Code'), { recursive: true });
  mkdirSync(work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(work, 'README.md'), '# Widgets\n');
  git(work, 'add', '.');
  git(
    work,
    '-c',
    'user.name=Test Person',
    '-c',
    'user.email=test@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'start',
  );
  const bare = path.join(CLONE_TEST_ROOT, 'sources', 'acme', 'widgets.git');
  mkdirSync(path.dirname(bare), { recursive: true });
  git(CLONE_TEST_ROOT, 'clone', '-q', '--bare', work, bare);
}

async function forgetJobs(page: Page) {
  const listed = (await (await page.request.get('/api/project-clones')).json()) as {
    jobs: CloneJob[];
  };
  for (const job of listed.jobs) {
    await page.request.post(`/api/project-clones/${job.id}/cancel`, { data: {} });
    await page.request.delete(`/api/project-clones/${job.id}`, { data: {} });
  }
}

test.beforeEach(async ({ page }) => {
  seedSource();
  await resetTestDatabase({ onboarded: true });
  await page.request.post(`http://127.0.0.1:${STUB_PORT}/github-test/reset`);
  await page.request.delete('/api/github/token', { data: {} });
  await page.request.delete('/api/github/app', { data: {} });
  await forgetJobs(page);
});

test.afterAll(() => {
  rmSync(CLONE_TEST_ROOT, { recursive: true, force: true });
});

const cloneDialog = (page: Page) => page.getByRole('dialog', { name: 'Clone a repository' });

async function openClone(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'Add project' }).click();
  const chooser = page.getByRole('dialog', { name: 'Choose a project folder' });
  await chooser.getByRole('radio', { name: 'Clone a repository' }).click();
  await expect(cloneDialog(page)).toBeVisible();
  return cloneDialog(page);
}

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).include('.fdlg').analyze();
  expect(
    results.violations.map((violation) => ({
      rule: violation.id,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
}

async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const before = await page.evaluate(() => document.documentElement.dataset.skin ?? '');
  for (const [skin, label] of [
    ['light', 'light'],
    ['graphite', 'dark'],
  ] as const) {
    await page.evaluate((value) => (document.documentElement.dataset.skin = value), skin);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `clone-${name}-${label}.png`) });
  }
  await page.evaluate((value) => (document.documentElement.dataset.skin = value), before);
}

function job(fields: Partial<CloneJob>): CloneJob {
  return {
    id: JOB_ID,
    source: WIDGETS_URL,
    destination: path.join(DOCUMENTS, 'widgets'),
    displayPath: '~/Documents/widgets',
    status: 'cloning',
    phase: 'Receiving objects',
    percent: 41,
    project: null,
    failure: null,
    startedAt: '2026-10-05T12:00:00.000Z',
    ...fields,
  };
}

async function serveJob(page: Page, current: { job: CloneJob | null }) {
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route(/\/api\/project-clones$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(json({ jobs: current.job ? [current.job] : [] }))
      : route.fulfill(json(current.job)),
  );
  await page.route(/\/api\/project-clones\/[^/]+\/cancel$/, (route) => {
    current.job = job({ status: 'cancelled', phase: 'Connecting', percent: null });
    return route.fulfill(json(current.job));
  });
  await page.route(/\/api\/project-clones\/[0-9a-f-]{36}$/, (route) => {
    current.job = null;
    return route.fulfill(json({ jobs: [] }));
  });
}

test('pastes an address, clones it and adds the project from the sidebar', async ({ page }) => {
  const dialog = await openClone(page);
  await expect(dialog.getByText('To pick from your repositories,')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'connect GitHub' })).toBeVisible();
  const clone = dialog.getByRole('button', { name: 'Clone', exact: true });
  await expect(clone).toBeDisabled();

  const address = dialog.getByRole('textbox', { name: 'Clone address' });
  await address.fill('file:///tmp/secret.git');
  await expect(dialog.getByText(/can't clone from a file address/)).toBeVisible();
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(clone).toBeDisabled();
  await address.fill('https://me:hunter2@github.com/acme/widgets.git');
  await expect(dialog.getByText(/username or password in it/)).toBeVisible();

  await address.fill(WIDGETS_URL);
  await expect(dialog.getByRole('textbox', { name: 'Folder name' })).toHaveValue('widgets');
  await expect(dialog.locator('.fdlg-path')).toHaveText(path.join(DOCUMENTS, 'widgets'));
  await axeClean(page);
  await shots(page, 'paste');

  await address.press('Enter');
  await expect(page.getByText('Added project widgets')).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Chats' }).getByText('widgets', { exact: true }),
  ).toBeVisible();
  expect(readFileSync(path.join(DOCUMENTS, 'widgets', 'README.md'), 'utf8')).toBe('# Widgets\n');
  const projects = (await (await page.request.get('/api/projects')).json()) as {
    rootPath: string;
  }[];
  expect(projects.map((project) => project.rootPath)).toEqual([path.join(DOCUMENTS, 'widgets')]);
});

test('picks a repository from the GitHub list, changes the folder and clones', async ({ page }) => {
  const saved = await page.request.put('/api/github/token', { data: { token: PAT } });
  expect(saved.ok()).toBe(true);
  const dialog = await openClone(page);
  const repos = dialog.getByRole('list', { name: 'Repositories' });
  await expect(repos.getByRole('button')).toHaveText(['acme/widgets', 'octo/notes']);
  await dialog.getByRole('searchbox', { name: 'Search repositories' }).fill('WID');
  await expect(repos.getByRole('button')).toHaveText(['acme/widgets']);
  await shots(page, 'pick');
  await repos.getByRole('button', { name: 'acme/widgets' }).click();
  await expect(repos.getByRole('button', { name: 'acme/widgets' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByRole('textbox', { name: 'Clone address' })).toHaveValue(WIDGETS_URL);
  await axeClean(page);

  await dialog.getByRole('button', { name: 'Change…' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose where to clone' });
  await expect(picker.getByRole('radiogroup')).toHaveCount(0);
  await expect(picker.locator('.fdlg-path')).toHaveText(DOCUMENTS);
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('textbox', { name: 'Clone address' })).toHaveValue(WIDGETS_URL);
  await dialog.getByRole('button', { name: 'Change…' }).click();
  await picker
    .getByRole('list', { name: 'Folders' })
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await picker.getByRole('button', { name: 'Clone into this folder' }).click();

  const name = dialog.getByRole('textbox', { name: 'Folder name' });
  await name.fill('../escape');
  await expect(dialog.getByText('A folder name can’t contain a slash.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Clone', exact: true })).toBeDisabled();
  await name.fill('my-widgets');
  const target = path.join(DOCUMENTS, 'Code', 'my-widgets');
  await expect(dialog.locator('.fdlg-path')).toHaveText(target);
  await dialog.getByRole('button', { name: 'Clone', exact: true }).click();
  await expect(page.getByText('Added project my-widgets')).toBeVisible({ timeout: 20_000 });
  expect(existsSync(path.join(target, '.git'))).toBe(true);
  expect(readFileSync(path.join(target, '.git', 'config'), 'utf8')).not.toContain(PAT);
});

test('refuses a destination that already has files and keeps the form', async ({ page }) => {
  mkdirSync(path.join(DOCUMENTS, 'widgets'));
  writeFileSync(path.join(DOCUMENTS, 'widgets', 'mine.txt'), 'keep');
  const dialog = await openClone(page);
  await dialog.getByRole('textbox', { name: 'Clone address' }).fill(WIDGETS_URL);
  await dialog.getByRole('button', { name: 'Clone', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already exists and is not empty');
  await expect(dialog.getByRole('textbox', { name: 'Clone address' })).toHaveValue(WIDGETS_URL);
  expect(readFileSync(path.join(DOCUMENTS, 'widgets', 'mine.txt'), 'utf8')).toBe('keep');
});

test('shows progress, survives closing the dialog, and cancels', async ({ page }) => {
  const current = { job: job({}) as CloneJob | null };
  await serveJob(page, current);
  await openChats(page);
  await page.getByRole('button', { name: 'Add project' }).click();
  const dialog = cloneDialog(page);
  const bar = dialog.getByRole('progressbar', { name: 'Clone progress' });
  await expect(bar).toHaveAttribute('aria-valuenow', '41');
  await expect(bar).toHaveAttribute('aria-valuetext', 'Receiving objects, 41%');
  await expect(dialog.getByRole('status')).toHaveText('Receiving objects');
  await axeClean(page);
  await shots(page, 'progress');

  current.job = job({ phase: 'Resolving deltas', percent: 88 });
  await expect(bar).toHaveAttribute('aria-valuenow', '88');
  await expect(dialog.getByRole('status')).toHaveText('Resolving deltas');

  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Add project' }).click();
  await expect(bar).toHaveAttribute('aria-valuenow', '88');

  await dialog.getByRole('button', { name: 'Cancel clone' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Clone cancelled. Nothing was added.');
  await expect(dialog.getByRole('textbox', { name: 'Clone address' })).toBeVisible();
});

test('shows a failed clone with a plain reason and lets you try again', async ({ page }) => {
  const current = {
    job: job({
      status: 'failed',
      percent: null,
      failure: {
        kind: 'auth',
        summary:
          'Sign-in failed. Check that your GitHub connection or your own git login can read this repository.',
        detail:
          "fatal: unable to access 'https://x-access-token:[redacted:url_password]@github.com/acme/widgets.git/': The requested URL returned error: 403",
      },
    }) as CloneJob | null,
  };
  await serveJob(page, current);
  await openChats(page);
  await page.getByRole('button', { name: 'Add project' }).click();
  const dialog = cloneDialog(page);
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('Sign-in failed.');
  await expect(alert).toContainText('[redacted:url_password]');
  await expect(dialog.getByText('Nothing was added to your projects.')).toBeVisible();
  await axeClean(page);
  await shots(page, 'error');

  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Clone address' })).toHaveValue(WIDGETS_URL);
  await expect(dialog.getByRole('textbox', { name: 'Folder name' })).toHaveValue('widgets');
  await expect(dialog.locator('.fdlg-path')).toHaveText(path.join(DOCUMENTS, 'widgets'));
});

test('keeps keyboard focus inside the dialog and offers cloning from the empty Map', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'map'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a project' }).click();
  const chooser = page.getByRole('dialog', { name: 'Choose a project folder' });
  await chooser.getByRole('radio', { name: 'Choose a folder' }).focus();
  await page.keyboard.press('ArrowRight');
  const dialog = cloneDialog(page);
  await expect(dialog.getByRole('radio', { name: 'Clone a repository' })).toBeFocused();
  const address = dialog.getByRole('textbox', { name: 'Clone address' });
  await address.fill(WIDGETS_URL);
  for (let presses = 0; presses < 12; presses += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await address.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your code, as a night sky' })).toHaveCount(0, {
    timeout: 20_000,
  });
  expect(existsSync(path.join(DOCUMENTS, 'widgets', '.git'))).toBe(true);
});
