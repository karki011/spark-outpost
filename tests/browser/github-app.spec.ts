import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP_USER_CODE } from '../../apps/server/test/fake-github-app.ts';
import { repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { connectorCard, connectorHead, connectorStatus } from './connector-cards.ts';
import { resetTestDatabase } from './database.ts';
import { STUB_PORT } from './stub-config.ts';

const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
const SHOTS = process.env.SPARK_GITHUB_APP_SHOTS;
const INSTALL_URL = 'https://github.com/apps/spark-outpost-test/installations/new';

test.describe.configure({ timeout: 90_000 });
let base = '';

const setApp = (request: APIRequestContext, fields: object) =>
  request.post(`${STUB_URL}/github-test/app`, { data: fields });

test.beforeEach(async ({ request }) => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-github-app-ui-')));
  await resetTestDatabase({ onboarded: true });
  await request.post(`${STUB_URL}/github-test/reset`);
  await request.delete('/api/github/app', { data: {} });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(SHOTS, `github-app-${name}.png`) });
}

async function linkProject(page: Page, name: string) {
  const repo = await repoWithRemote(base, name);
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
}

async function openGitHubCard(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  const card = connectorCard(page, 'github');
  await connectorHead(card).click();
  return card;
}

async function signIn(page: Page) {
  const card = await openGitHubCard(page);
  await card.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(card.getByRole('group', { name: 'GitHub sign-in code' })).toBeVisible();
  await setApp(page.request, { decision: 'approved' });
  await expect(card).toContainText('Signed in as @octo-app', { timeout: 15_000 });
  return card;
}

test('signing in shows a code, survives closing Settings, and lists covered repos @packaged', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await linkProject(page, 'widgets');
  const card = await openGitHubCard(page);
  const methods = card.getByRole('radiogroup', { name: 'How to connect GitHub' });
  await expect(methods.getByRole('radio', { name: 'GitHub sign-in' })).toBeChecked();
  await expect(card).toContainText('Spark can only use the repositories you pick on GitHub.');

  await card.getByRole('button', { name: 'Sign in with GitHub' }).click();
  const code = card.getByRole('group', { name: 'GitHub sign-in code' });
  await expect(code.locator('output')).toHaveText(APP_USER_CODE);
  const open = code.getByRole('link', { name: 'Open GitHub' });
  await expect(open).toHaveAttribute('href', 'https://github.com/login/device');
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(code.getByRole('status').last()).toContainText('Waiting for you to finish');
  await code.getByRole('button', { name: 'Copy' }).focus();
  await page.keyboard.press('Tab');
  await expect(open).toBeFocused();
  await shot(page, 'sign-in-code');

  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  const reopened = await openGitHubCard(page);
  await expect(reopened.getByRole('group', { name: 'GitHub sign-in code' })).toContainText(
    APP_USER_CODE,
  );

  await setApp(page.request, { decision: 'approved' });
  await expect(reopened).toContainText('Signed in as @octo-app', { timeout: 15_000 });
  await expect(connectorStatus(reopened)).toHaveText('Signed in to GitHub as octo-app');
  await expect(reopened.locator('.pill-ok')).toHaveText('Connected');
  const projects = reopened.getByRole('list', { name: 'Your projects' });
  await expect(projects).toContainText('widgets');
  await expect(projects).toContainText('covered');
  await expect(reopened.getByRole('region', { name: 'Pull request route' })).toContainText(
    'PRs via GitHub sign-in (you)',
  );
  await reopened.locator('.gh-repos summary').click();
  await expect(reopened.getByRole('list', { name: 'Repositories Spark can use' })).toContainText(
    'acme/widgets',
  );
  await expect(reopened).not.toContainText('ghu_');
  await shot(page, 'connected');

  const audit = await new AxeBuilder({ page })
    .include('.cx-card[data-connector="github"]')
    .analyze();
  expect(audit.violations.filter((issue) => issue.impact !== 'minor')).toEqual([]);

  await reopened.getByRole('button', { name: 'Test' }).click();
  await expect(reopened.getByRole('list', { name: 'Test results' })).toContainText(
    'signed in to github.com as octo-app',
  );

  await reopened.getByRole('button', { name: 'Disconnect' }).click();
  await expect(reopened.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
  await expect(reopened.locator('.pill-ok')).toHaveCount(0);
});

test('a project the app does not cover offers access and re-checks on return', async ({ page }) => {
  await page.goto('/');
  await linkProject(page, 'widgets');
  await setApp(page.request, { repos: ['acme/other'] });
  const card = await signIn(page);
  const projects = card.getByRole('list', { name: 'Your projects' });
  await expect(projects).toContainText('not covered');
  const give = projects.getByRole('link', { name: 'Give Spark access to this repo' });
  await expect(give).toHaveAttribute('href', INSTALL_URL);
  await expect(give).toHaveAttribute('target', '_blank');

  await setApp(page.request, { repos: ['acme/other', 'acme/widgets'] });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(projects).not.toContainText('not covered');
  await expect(projects.getByRole('link')).toHaveCount(0);
});

test('cancel, a refused code, and falling back to a token', async ({ page }) => {
  await page.goto('/');
  const card = await openGitHubCard(page);
  await card.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(card.getByRole('group', { name: 'GitHub sign-in code' })).toBeVisible();
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(card.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();

  await setApp(page.request, { decision: 'denied' });
  await card.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(card.getByRole('alert')).toContainText('cancelled on GitHub', { timeout: 15_000 });

  await card.getByRole('button', { name: 'Use a token instead' }).click();
  await card
    .getByLabel('Personal access token')
    .fill('github_pat_11ABCDEFG0123456789_abcdefghijkl');
  await card.getByRole('button', { name: 'Verify token' }).click();
  await expect(connectorStatus(card)).toHaveText('Connected with a token as octo-token');
  await page.request.delete('/api/github/token', { data: {} });
});

test('a refused refresh asks to sign in again without blocking', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await linkProject(page, 'widgets');
  const card = await signIn(page);
  await setApp(page.request, { rejectRefresh: true, revoke: true });
  await card.getByRole('button', { name: 'Test' }).click();
  await expect(card.getByRole('list', { name: 'Test results' })).toContainText('sign-in failed');
  await expect(card).toContainText('Your GitHub sign-in as @octo-app ended', { timeout: 15_000 });
  await expect(connectorStatus(card)).toContainText('Sign in again');
  await expect(card.getByRole('button', { name: 'Sign in again', exact: true })).toBeVisible();
  await shot(page, 'needs-sign-in');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Home' }).first().click();
  const notice = page.locator('.ps-warn', { hasText: 'GitHub: your sign-in ended' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Sign in again' }).click();
  await expect(page.getByRole('tab', { name: 'Connectors' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
