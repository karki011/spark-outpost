import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  SLACK_APP_TOKEN,
  SLACK_BOT_TOKEN,
  SLACK_USER_TOKEN,
} from '../../apps/server/test/fake-slack.ts';
import { resetTestDatabase } from './database.ts';
import { useSystemTheme } from './docs-seed.ts';
import {
  approveInFakeSlack,
  connectSlack,
  endSlackSignIn,
  openSlackCard,
  resetSlackFake,
  slackOAuth,
} from './slack-seed.ts';

const SHOTS = process.env.SPARK_SLACK_SHOTS;

async function snap(page: Page, card: Locator, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png`, animations: 'disabled' });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function neverReachSlack(context: BrowserContext): Promise<string[]> {
  const opened: string[] = [];
  await context.route('https://slack.com/**', (route) => {
    opened.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'fake Slack' });
  });
  return opened;
}

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('.cx-card[data-connector="slack"]')
    .analyze();
  expect(results.violations).toEqual([]);
}

async function signInByApi(page: Page): Promise<void> {
  const started = await page.request.post('/api/slack/sign-in', { data: {} });
  const flow = (await started.json()) as { authorizeUrl: string };
  await approveInFakeSlack(page, flow.authorizeUrl);
  await page.request.put('/api/slack/channels', {
    data: { channels: [{ id: 'C0ENG', projectId: null }] },
  });
}

const heading = (card: Locator) => card.locator('.pc-head .nm small');

let openedInBrowser: string[] = [];

test.beforeEach(async ({ page, context }) => {
  await resetTestDatabase({ onboarded: true });
  await resetSlackFake();
  await page.request.delete('/api/slack/sign-in');
  if (SHOTS) await useSystemTheme(page);
  openedInBrowser = await neverReachSlack(context);
});

test('Settings signs in with Slack in the browser and shows what a sign-in can do @packaged', async ({
  page,
}) => {
  const card = await openSlackCard(page);
  const signIn = card.getByRole('button', { name: 'Sign in with Slack' });
  const ownApp = card.getByRole('button', { name: 'Use your own Slack app' });
  await expect(card.getByRole('heading', { name: 'Sign in with Slack' })).toBeVisible();
  await expect(card).toContainText('No app to create, no tokens to paste.');
  await expect(card).toContainText('Adds a Spark bot');
  await expect(ownApp).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByRole('form', { name: 'Connect Slack' })).toHaveCount(0);
  await axe(page);
  await snap(page, card, 'slack-methods');

  await ownApp.focus();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('form', { name: 'Connect Slack' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('form', { name: 'Connect Slack' })).toHaveCount(0);

  await signIn.focus();
  await page.keyboard.press('Enter');
  const waiting = card.getByRole('group', { name: 'Slack sign-in' });
  await expect(waiting.getByRole('status')).toContainText('Waiting for you to finish in Slack');
  const link = waiting.getByRole('link', { name: 'Open Slack again' });
  const authorizeUrl = (await link.getAttribute('href'))!;
  const asked = new URL(authorizeUrl);
  expect(asked.origin + asked.pathname).toBe('https://slack.com/oauth/v2/authorize');
  expect(asked.searchParams.get('code_challenge_method')).toBe('S256');
  expect(asked.searchParams.get('redirect_uri')).toBe('spark-outpost://slack/callback');
  expect(asked.searchParams.has('scope')).toBe(false);
  expect(authorizeUrl).not.toMatch(/secret/i);
  await expect.poll(() => openedInBrowser).toEqual([authorizeUrl]);
  await axe(page);
  await snap(page, card, 'slack-sign-in-waiting');

  const wrong = await page.request.post('/api/slack/sign-in/callback', {
    data: { url: 'spark-outpost://slack/callback?code=stolen&state=not-the-state' },
  });
  expect(wrong.status()).toBe(400);
  await expect(waiting.getByRole('status')).toContainText('Waiting for you to finish in Slack');

  await approveInFakeSlack(page, authorizeUrl);

  await expect(heading(card)).toHaveText('Connected to Acme as Alex Example', { timeout: 10_000 });
  const caps = card.getByRole('list', { name: 'What Slack can do' });
  await expect(caps).toContainText('Posts updates as you, always after you confirm');
  await expect(caps).toContainText('Notifies you with a message to yourself');
  await expect(caps).toContainText('Starting work inside Slack needs your own Slack app');
  await expect(card.getByLabel('Your Slack member ID')).toHaveCount(0);
  const seen = await slackOAuth();
  expect(Object.keys(seen.requests[0]!).sort()).toEqual([
    'client_id',
    'code',
    'code_verifier',
    'redirect_uri',
  ]);
  const shown = await page.content();
  for (const secret of [seen.access!, seen.refresh!, seen.requests[0]!.code_verifier!]) {
    expect(shown).not.toContain(secret);
  }
  await axe(page);
  await snap(page, card, 'slack-signed-in');

  await card.getByRole('button', { name: 'Set up your own Slack app' }).click();
  await expect(card.getByRole('note')).toContainText('switches Slack to your own app');
  await expect(card.getByRole('button', { name: 'Save and switch' })).toBeVisible();
  await card.getByRole('button', { name: 'Keep my Slack sign-in' }).click();
  await expect(caps).toBeVisible();
});

test('a sign-in can be cancelled in Spark or in Slack, each with a plain message', async ({
  page,
}) => {
  const card = await openSlackCard(page);
  await card.getByRole('button', { name: 'Sign in with Slack' }).click();
  const waiting = card.getByRole('group', { name: 'Slack sign-in' });
  await waiting.getByRole('button', { name: 'Cancel' }).click();
  await expect(card.getByRole('button', { name: 'Sign in with Slack' })).toBeVisible();
  await expect(card.getByRole('alert')).toHaveCount(0);

  await card.getByRole('button', { name: 'Sign in with Slack' }).click();
  const href = (await waiting
    .getByRole('link', { name: 'Open Slack again' })
    .getAttribute('href'))!;
  await approveInFakeSlack(page, href, 'access_denied');

  await expect(card.getByRole('alert')).toHaveText('The sign-in was cancelled in Slack.', {
    timeout: 10_000,
  });
  await expect(card.getByRole('button', { name: 'Sign in with Slack' })).toBeEnabled();
  const status = (await (await page.request.get('/api/slack')).json()) as { connection: unknown };
  expect(status.connection).toBeNull();
});

test('switching between your own app and a sign-in asks first, both ways', async ({ page }) => {
  await connectSlack(page);
  const card = await openSlackCard(page);
  await expect(heading(card)).toHaveText('Connected to Acme as spark');

  await card.getByRole('button', { name: 'Sign in with Slack instead' }).click();
  await card.getByRole('button', { name: 'Sign in with Slack' }).click();
  const confirm = card.getByRole('group', { name: 'Switch to Slack sign-in' });
  await expect(confirm).toContainText('removes your Slack app’s tokens from this Mac');
  await expect(confirm.getByRole('button', { name: 'Switch and sign in' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Keep my Slack app' }).click();
  expect((await slackOAuth()).requests).toHaveLength(0);

  await card.getByRole('button', { name: 'Sign in with Slack' }).click();
  await confirm.getByRole('button', { name: 'Switch and sign in' }).click();
  const href = (await card.getByRole('link', { name: 'Open Slack again' }).getAttribute('href'))!;
  await approveInFakeSlack(page, href);
  await expect(heading(card)).toHaveText('Connected to Acme as Alex Example', { timeout: 10_000 });
  await expect(card.getByRole('list', { name: 'Slack channels' })).toBeVisible();
  const signedIn = (await slackOAuth()).access!;

  await card.getByRole('button', { name: 'Use your own Slack app' }).click();
  const form = card.getByRole('form', { name: 'Connect Slack' });
  await expect(form).toBeVisible();
  await form.getByLabel('Bot token').fill(SLACK_BOT_TOKEN);
  await form.getByLabel('User token (optional)').fill(SLACK_USER_TOKEN);
  await form.getByLabel('App-level token (optional)').fill(SLACK_APP_TOKEN);
  await form.getByRole('button', { name: 'Save and switch' }).click();

  await expect(heading(card)).toHaveText('Connected to Acme as spark');
  expect((await slackOAuth()).revoked).toEqual([signedIn]);
  const status = (await (await page.request.get('/api/slack')).json()) as {
    connection: { method: string; allowedChannels: unknown[] };
  };
  expect(status.connection.method).toBe('own_app');
  expect(status.connection.allowedChannels).toHaveLength(1);
});

test('a sign-in that Slack ended says so and offers to sign in again', async ({ page }) => {
  await signInByApi(page);
  await endSlackSignIn();
  const failed = await page.request.post('/api/slack/test', { data: {} });
  expect(failed.ok()).toBe(false);

  const card = await openSlackCard(page);

  await expect(heading(card)).toHaveText('Sign in again to use Acme');
  await expect(card.locator('.pill-ok')).toHaveCount(0);
  const ended = card.getByRole('group', { name: 'Slack sign-in ended' });
  await expect(ended.getByRole('status')).toContainText('Your Slack sign-in ended.');
  await expect(ended.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  await expect(card.getByRole('list', { name: 'Slack channels' })).toHaveCount(0);
  await axe(page);
  await snap(page, card, 'slack-sign-in-ended');
});
