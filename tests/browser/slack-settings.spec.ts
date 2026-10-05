import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SLACK_BOT_TOKEN, SLACK_USER_TOKEN } from '../../apps/server/test/fake-slack.ts';
import { resetTestDatabase } from './database.ts';
import {
  connectSlack,
  openSlackCard,
  resetSlackFake,
  slackPosts,
  useLegacySlackScopes,
} from './slack-seed.ts';

const SHOTS = process.env.SPARK_SLACK_SHOTS;
async function snap(page: Page, target: Locator, name: string): Promise<void> {
  if (!SHOTS) return;
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/slack-${name}.png` });
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await resetSlackFake();
});

test('Settings connects Slack from pasted tokens and shows what each token allows @packaged', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const card = await openSlackCard(page);
  await card.getByRole('button', { name: 'Use your own Slack app' }).click();
  const form = card.getByRole('form', { name: 'Connect Slack' });
  await expect(form.getByRole('list', { name: 'Create your Slack app' })).toContainText(
    '/invite @Spark',
  );
  await form.getByRole('button', { name: 'Copy manifest' }).click();
  await expect(form.getByText('Copied. Paste it in the next step.')).toBeVisible();
  const manifest = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
    settings: { socket_mode_enabled: boolean };
    oauth_config: { scopes: { bot: string[] } };
  };
  expect(manifest.settings.socket_mode_enabled).toBe(true);
  expect(manifest.oauth_config.scopes.bot).toContain('chat:write');
  await snap(page, form.getByLabel('Bot token'), 'manifest-steps');

  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.getByRole('alert')).toContainText('Paste the bot token.');
  await expect(form.getByLabel('Bot token')).toBeFocused();

  await form.getByLabel('Bot token').fill('xoxb-0000000000-notarealtoken');
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.getByRole('alert')).toContainText('Slack rejected this token');

  await form.getByLabel('Bot token').fill(SLACK_BOT_TOKEN);
  await form.getByLabel('User token (optional)').fill(SLACK_USER_TOKEN);
  await form.getByRole('button', { name: 'Save and check' }).click();

  await expect(card.locator('.pc-head .nm small')).toHaveText('Connected to Acme as spark');
  const caps = card.getByRole('list', { name: 'What Slack can do' });
  await expect(caps).toContainText('Agents can search allowed channels');
  await expect(caps).toContainText('Starting work inside Slack needs an app-level token');
  await expect(card).not.toContainText(SLACK_BOT_TOKEN);
  await expect(card.getByText('Spark sends direct messages to Alex Example.')).toBeVisible();
});

test('the allowed channels picker searches, pages and saves, and feeds the other pickers', async ({
  page,
}) => {
  await connectSlack(page, []);
  const card = await openSlackCard(page);
  const channels = card.getByRole('list', { name: 'Slack channels' });
  await expect(channels.getByRole('checkbox')).toHaveCount(3);
  await card.getByRole('button', { name: 'Load more channels' }).click();
  await expect(channels.getByRole('checkbox')).toHaveCount(5);
  await expect(card.getByRole('button', { name: 'Load more channels' })).toHaveCount(0);

  await card.getByLabel('Search channels').fill('eng');
  await expect(channels.getByRole('checkbox')).toHaveCount(1);
  await channels.getByRole('checkbox', { name: '#eng' }).click();
  await expect(channels.getByRole('checkbox', { name: '#eng' })).toBeChecked();
  await card.getByLabel('Search channels').fill('');
  await expect(channels.getByRole('checkbox', { name: '#eng' })).toBeChecked();
  await expect(channels.getByText('Invite the app to post here').first()).toBeVisible();
  await snap(page, channels, 'allowed-channels');

  await card.getByRole('button', { name: 'Default channel for updates' }).click();
  await page.getByRole('menuitemradio', { name: '#eng' }).click();
  await expect
    .poll(async () => {
      const status = (await (await page.request.get('/api/slack')).json()) as {
        connection: { settings: { defaultChannelId: string | null } };
      };
      return status.connection.settings.defaultChannelId;
    })
    .toBe('C0ENG');
});

test('notification choices save, preview and send a test message', async ({ page }) => {
  await connectSlack(page);
  const card = await openSlackCard(page);
  const preview = card.getByRole('figure', { name: 'Notification preview' });
  await expect(preview).toContainText('Needs your approval');
  await expect(preview).not.toContainText('guardrail');

  await card.getByRole('switch', { name: 'A chat finished' }).click();
  await expect(preview).not.toContainText('Finished');
  await card.getByRole('switch', { name: 'A guardrail flag' }).click();
  await expect(preview).toContainText('Flagged an action that crossed a guardrail');
  await snap(page, preview, 'notification-preview');
  await snap(page, card.locator('button.pc-head'), 'settings-card');

  await card.getByRole('button', { name: 'Send a test message' }).click();
  await expect(card.getByText('Sent to you, as a direct message.')).toBeVisible();
  expect((await slackPosts()).at(-1)).toMatchObject({ channel: 'U0ME' });

  const results = await new AxeBuilder({ page })
    .include('.cx-card[data-connector="slack"]')
    .analyze();
  expect(results.violations).toEqual([]);
});

test('Disconnect waits out the grace period and removes the connection', async ({ page }) => {
  await connectSlack(page);
  const card = await openSlackCard(page);
  await card.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card.locator('.pc-head .nm small')).toHaveText('Connected to Acme as spark');

  await card.getByRole('button', { name: 'Disconnect' }).click();
  await expect(card.getByRole('button', { name: 'Sign in with Slack' })).toBeVisible({
    timeout: 10_000,
  });
  const status = (await (await page.request.get('/api/slack')).json()) as { connection: unknown };
  expect(status.connection).toBeNull();
});

async function allowedDirectMessages(page: Page): Promise<string[]> {
  const status = (await (await page.request.get('/api/slack')).json()) as {
    connection: { directMessages: { allowed: { id: string }[] } };
  };
  return status.connection.directMessages.allowed.map((conversation) => conversation.id);
}

test('direct messages stay unread until the switch is on and a conversation is ticked', async ({
  page,
}) => {
  await connectSlack(page);
  const card = await openSlackCard(page);
  const section = card.getByRole('region', { name: 'Direct messages' });
  const reads = section.getByRole('switch', { name: 'Let Spark read my direct messages' });
  const caps = card.getByRole('list', { name: 'What Slack can do' });
  await expect(reads).not.toBeChecked();
  await expect(caps).toContainText('Direct messages are not read');
  await expect(section.getByRole('list', { name: 'Slack direct messages' })).toHaveCount(0);

  await reads.focus();
  await page.keyboard.press('Space');
  await expect(reads).toBeChecked();
  const conversations = section.getByRole('list', { name: 'Slack direct messages' });
  await expect(conversations.getByRole('checkbox')).toHaveCount(3);
  await expect(conversations.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Load more direct messages' }).click();
  await expect(conversations.getByRole('checkbox')).toHaveCount(5);
  await expect(conversations).toContainText('alex, sam, kim');
  await expect(conversations).toContainText('Group message');

  await section.getByLabel('Search direct messages').fill('sam o');
  await expect(conversations.getByRole('checkbox')).toHaveCount(1);
  await conversations.getByRole('checkbox', { name: 'Sam Ortiz' }).click();
  await expect(conversations.getByRole('checkbox', { name: 'Sam Ortiz' })).toBeChecked();
  await section.getByLabel('Search direct messages').fill('');
  await expect(caps).toContainText('Reads the direct messages you allowed');
  expect(await allowedDirectMessages(page)).toEqual(['D0SAM']);
  await snap(page, section.getByRole('heading', { name: 'Direct messages' }), 'dm-settings');

  const results = await new AxeBuilder({ page })
    .include('.cx-card[data-connector="slack"]')
    .analyze();
  expect(results.violations).toEqual([]);

  const all = section.getByRole('checkbox', { name: 'All my direct messages' });
  await expect(all).not.toBeChecked();
  await all.click();
  await expect(conversations.getByRole('checkbox', { name: 'Kim Lee' })).toBeChecked();
  await expect(conversations.getByRole('checkbox', { name: 'Kim Lee' })).toBeDisabled();
  await all.click();
  await expect(conversations.getByRole('checkbox', { name: 'Kim Lee' })).not.toBeChecked();

  await reads.click();
  await expect(section.getByRole('list', { name: 'Slack direct messages' })).toHaveCount(0);
  await expect.poll(() => allowedDirectMessages(page)).toEqual([]);
});

test('an app installed before direct messages shows how to update it, then checks again', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await useLegacySlackScopes();
  await connectSlack(page);
  const card = await openSlackCard(page);
  const section = card.getByRole('region', { name: 'Direct messages' });
  const update = section.getByRole('group', {
    name: 'Update the Slack app to allow direct messages',
  });
  await expect(update.getByRole('list', { name: 'Permissions to add' })).toContainText(
    'im:history',
  );
  await expect(update.getByRole('list', { name: 'Update your Slack app' })).toContainText(
    'Reinstall to Workspace',
  );
  await expect(section.getByRole('switch')).toBeDisabled();
  await snap(page, update, 'dm-update-app');

  await update.getByRole('button', { name: 'Copy updated manifest' }).click();
  const manifest = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
    oauth_config: { scopes: { bot: string[]; user: string[] } };
  };
  expect(manifest.oauth_config.scopes.user).toEqual(
    expect.arrayContaining(['im:read', 'im:history', 'mpim:read', 'mpim:history']),
  );
  expect(manifest.oauth_config.scopes.bot.join(' ')).not.toMatch(/\bm?pim:|\bim:/);

  await update.getByRole('button', { name: 'Check again' }).click();
  await expect(update.getByText('Still missing. Reinstall the app in Slack first.')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('.cx-card[data-connector="slack"]')
    .analyze();
  expect(results.violations).toEqual([]);

  await resetSlackFake();
  await update.getByRole('button', { name: 'Check again' }).click();
  await expect(update).toHaveCount(0);
  await expect(section.getByRole('switch')).toBeEnabled();
});
