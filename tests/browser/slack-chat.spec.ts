import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { slackLink } from '../../apps/server/test/fake-slack.ts';
import { resetCrew, send } from './crew-engine.ts';
import { openChats } from './navigation.ts';
import { connectSlack, resetSlackFake, slackPosts } from './slack-seed.ts';

const SHOTS = process.env.SPARK_SLACK_SHOTS;
const THREAD = slackLink('C0ENG', '1760000000.000100');

test.beforeEach(async ({ page }) => {
  await resetCrew();
  await resetSlackFake();
  await page.setViewportSize({ width: 1400, height: 900 });
});

async function paste(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.focus();
  await composer.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
  return composer;
}

test('pasting a Slack link adds a context chip, and a blocked channel can be allowed in one click @packaged', async ({
  page,
}) => {
  await connectSlack(page, ['C0ENG']);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();

  const composer = await paste(page, THREAD);
  const chips = page.getByRole('group', { name: 'Attachments' });
  const chip = chips.locator('.att-chip[data-slack]');
  await expect(chip).toContainText('#eng · Sam Ortiz · Uploads over 2 GB fail');
  await expect(composer).toHaveValue('');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/slack-context-chip.png` });

  await paste(page, slackLink('C0WEB', '1760000000.000100'));
  const blocked = chips.locator('.att-chip.failed');
  await expect(blocked).toContainText("#web-team isn't in your allowed Slack channels");
  await blocked.getByRole('button', { name: 'Allow this channel' }).click();
  await expect(blocked).toContainText("Slack can't find that message");
  const status = (await (await page.request.get('/api/slack')).json()) as {
    connection: { allowedChannels: { id: string }[] };
  };
  expect(status.connection.allowedChannels.map((channel) => channel.id)).toContain('C0WEB');
  await blocked.getByRole('button', { name: /Remove/ }).click();

  await paste(page, 'https://example.test/not-slack');
  await expect(chips.locator('.att-chip')).toHaveCount(1);
  const scan = await new AxeBuilder({ page }).include('.composer').analyze();
  expect(scan.violations).toEqual([]);
});

test('a direct message link is refused until allowed, then becomes a context chip @packaged', async ({
  page,
}) => {
  const link = slackLink('D0SAM', '1760001000.000100');
  await connectSlack(page, ['C0ENG']);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const chips = page.getByRole('group', { name: 'Attachments' });

  await paste(page, link);
  const off = chips.locator('.att-chip.failed');
  await expect(off).toContainText('unless you turn on "Let Spark read my direct messages"');
  await expect(off.getByRole('button', { name: /Allow/ })).toHaveCount(0);
  await off.getByRole('button', { name: /Remove/ }).click();
  await expect(chips.locator('.att-chip')).toHaveCount(0);

  await page.request.patch('/api/slack/settings', { data: { readDirectMessages: true } });
  await paste(page, link);
  const blocked = chips.locator('.att-chip.failed');
  await expect(blocked).toContainText("That direct message isn't in your allowed conversations");
  await blocked.getByRole('button', { name: 'Allow this conversation' }).click();

  const chip = chips.locator('.att-chip[data-slack]');
  await expect(chip).toContainText(
    'Direct message with Sam Ortiz · Sam Ortiz · Can you check the billing export?',
  );
  await expect(chip).toContainText('Slack direct message.md');
  await expect(chip).not.toContainText('dmleakedtokenvalue');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/slack-dm-context-chip.png` });
  const scan = await new AxeBuilder({ page }).include('.composer').analyze();
  expect(scan.violations).toEqual([]);
});

test('an agent asks to post to Slack and the user edits the text on the card first', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await connectSlack(page, ['C0ENG']);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();

  await send(
    page,
    '#build #spark spark_slack_post {"channel":"eng","text":"Upload retry is fixed. PR: https://github.com/acme/web/pull/128"}',
  );

  const card = page.getByRole('group', { name: /Post this to Slack\?/ });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card).toContainText('#eng');
  await expect(card).toContainText('A new message in the channel');
  await expect(card.getByLabel('Slack message')).toHaveValue(
    'Upload retry is fixed. PR: https://github.com/acme/web/pull/128',
  );
  expect(await slackPosts()).toEqual([]);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.sac')
    .analyze();
  expect(scan.violations).toEqual([]);
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/slack-post-confirm-card.png` });

  await card.getByLabel('Slack message').fill('Upload retry is fixed <!channel>');
  await card.getByRole('button', { name: 'Post to Slack' }).click();

  const resolved = page.getByRole('group', { name: /Post this to Slack\?/ });
  await expect(resolved).toContainText('Posted to #eng.', { timeout: 30_000 });
  expect(await slackPosts()).toMatchObject([
    { channel: 'C0ENG', text: 'Upload retry is fixed &lt;!channel&gt;', threadTs: null },
  ]);
});
