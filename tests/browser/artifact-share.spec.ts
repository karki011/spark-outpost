import { expect, test, type Page } from '@playwright/test';
import { BUSY_TITLE } from '../../apps/server/test/fake-share-service.ts';
import { openChats } from './navigation.ts';
import { permissionChip, pickMode } from './permissions-kit.ts';
import { resetWithAgents } from './project-chat-kit.ts';
import { STUB_PORT } from './stub-config.ts';

test.beforeEach(async () => {
  test.slow();
  await resetWithAgents();
});

const SHARE_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;
const SHARE_STATUS = /\/api\/artifacts\/([0-9a-f-]{36})\/versions\/\d+\/share$/;

async function publish(page: Page, title: string, kind = 'html', content = '<h1>Failures</h1>') {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await permissionChip(page).click();
  await pickMode(page, 'Auto');
  await page.keyboard.press('Escape');
  const args = { action: 'publish', title, kind, content };
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(`#build #sparkscript ${JSON.stringify([{ tool: 'spark_artifact', args }])}`);
  await input.press('Enter');
  await openPane(page, title);
}

async function openPane(page: Page, title: string) {
  await page
    .getByRole('group', { name: `Artifact ${title}` })
    .getByRole('button', { name: 'Open' })
    .click({ timeout: 30_000 });
  await expect(page.getByRole('region', { name: `Artifact ${title}` })).toBeVisible();
}

const pane = (page: Page, title: string) => page.getByRole('region', { name: `Artifact ${title}` });

test('the user shares a version with a passcode, copies both, and stops sharing @packaged', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await publish(page, 'Deploy failures');
  const share = pane(page, 'Deploy failures').getByRole('button', { name: 'Share…' });

  await share.click();
  const confirm = page.getByRole('dialog', { name: 'Share “Deploy failures”?' });
  await expect(confirm).toContainText('This uploads version 1');
  await expect(confirm).toContainText('Anyone with the link can open it.');
  await expect(confirm.getByRole('switch', { name: 'Require a passcode' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(confirm).toContainText('Shared from');
  await expect(confirm).toContainText('Spark’s shared service');
  await expect(confirm).toContainText('Expires in 1 day');
  await expect(confirm.getByRole('radio')).toHaveCount(0);
  await expect(confirm).toContainText(
    'Links from Spark’s shared service last 1 day. Connect your own Cloudflare account for 7 days.',
  );
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press('Tab');
    expect(await confirm.evaluate((box) => box.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(share).toBeFocused();

  await share.click();
  await confirm.getByRole('switch', { name: 'Require a passcode' }).click();
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/share'),
  );
  await confirm.getByRole('button', { name: 'Create link' }).click();
  const { theme } = (await sent).postDataJSON() as { theme: Record<string, string> };
  expect(theme.scheme).toMatch(/^(light|dark)$/);
  expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/);
  expect(Object.keys(theme)).toHaveLength(11);

  const shared = page.getByRole('dialog', { name: 'Shared · version 1' });
  await expect(shared).toBeVisible();
  await expect(shared.getByRole('button', { name: 'Done' })).toBeFocused();
  const link = await shared.getByRole('textbox', { name: 'Link' }).inputValue();
  expect(link.startsWith(`${SHARE_ORIGIN}/a/`)).toBe(true);
  const code = await shared.getByRole('textbox', { name: 'Passcode' }).inputValue();
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  await expect(shared).toContainText('5 wrong codes lock the link for 15 minutes');
  await expect(shared.getByRole('status')).toHaveText('Link copied to the clipboard.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  await shared.getByRole('button', { name: 'Copy link' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await shared.getByRole('button', { name: 'Copy code' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  await shared.getByRole('button', { name: 'Done' }).click();
  const sharedButton = pane(page, 'Deploy failures').getByRole('button', { name: 'Shared' });
  await expect(sharedButton).toBeFocused();

  await page.reload();
  await openPane(page, 'Deploy failures');
  await sharedButton.click();
  await expect(shared.getByRole('textbox', { name: 'Link' })).toHaveValue(link);
  await expect(shared.getByRole('textbox', { name: 'Passcode' })).toHaveCount(0);
  await expect(shared).toContainText('The passcode was shown when the link was made.');
  expect(await page.content()).not.toContain(code);

  await shared.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(shared).toHaveCount(0);
  await expect(share).toBeFocused();
});

test('Share… on a version already shared elsewhere opens its link with a note', async ({
  page,
}) => {
  const status = page.waitForRequest(/\/api\/artifacts\/[^/]+\/versions\/1\/share$/);
  await publish(page, 'Twice shared');
  const address = new URL((await status).url()).pathname;
  const made = await page.evaluate(async (path) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expiresInDays: 1, passcode: false }),
    });
    const body = (await response.json()) as { share: { url: string } };
    return { status: response.status, url: body.share.url };
  }, address);
  expect(made.status).toBe(201);

  const share = pane(page, 'Twice shared').getByRole('button', { name: 'Share…' });
  await share.click();
  const confirm = page.getByRole('dialog', { name: 'Share “Twice shared”?' });
  await confirm.getByRole('switch', { name: 'Require a passcode' }).click();
  await confirm.getByRole('button', { name: 'Create link' }).click();

  const shared = page.getByRole('dialog', { name: 'Shared · version 1' });
  await expect(shared.getByRole('status')).toHaveText(
    'This version is already shared. Stop sharing to make a new link with different settings.',
  );
  await expect(shared.getByRole('textbox', { name: 'Link' })).toHaveValue(made.url);
  await expect(shared.getByRole('textbox', { name: 'Passcode' })).toHaveCount(0);
  await shared.getByRole('button', { name: 'Done' }).click();
  await expect(pane(page, 'Twice shared').getByRole('button', { name: 'Shared' })).toBeFocused();
});

test('an error from the share service shows in the sheet and makes no link', async ({ page }) => {
  const title = `${BUSY_TITLE} report`;
  await publish(page, title);
  const share = pane(page, title).getByRole('button', { name: 'Share…' });
  await share.click();
  const confirm = page.getByRole('dialog', { name: `Share “${title}”?` });
  await confirm.getByRole('button', { name: 'Create link' }).click();
  await expect(confirm.getByRole('alert')).toHaveText(
    'The share service is busy. Try again in a few minutes.',
  );
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(share).toBeFocused();
});

const NO_SERVICE = { available: false, service: null, host: null, days: [], share: null };

test('Share… asks to connect Cloudflare when nothing can share, and is off for Markdown', async ({
  page,
}) => {
  await page.route('**/api/artifacts/*/versions/*/share', (route) =>
    route.fulfill({ json: NO_SERVICE }),
  );
  await publish(page, 'Quiet page');
  const quiet = pane(page, 'Quiet page').getByRole('button', { name: 'Share…' });
  await quiet.click();
  const prompt = page.getByRole('dialog', { name: 'Connect Cloudflare to share artifacts' });
  await expect(prompt.getByRole('button', { name: 'Connect Cloudflare' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveCount(0);
  await expect(quiet).toBeFocused();
  await quiet.click();
  await prompt.getByRole('button', { name: 'Connect Cloudflare' }).click();
  await expect(page.getByRole('tab', { name: 'Connectors' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Service address')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.unroute('**/api/artifacts/*/versions/*/share');
  await publish(page, 'Notes', 'markdown', '# Plan');
  const notes = pane(page, 'Notes').getByRole('button', { name: 'Share…' });
  await expect(notes).toHaveAttribute('aria-disabled', 'true');
  await expect(notes).toHaveAccessibleDescription(/Markdown artifacts can’t be shared yet/);
  await notes.click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a link made earlier can still be stopped when the build has no share service', async ({
  page,
}) => {
  await publish(page, 'Old link');
  const old = pane(page, 'Old link');
  await old.getByRole('button', { name: 'Share…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Share “Old link”?' });
  await confirm.getByRole('switch', { name: 'Require a passcode' }).click();
  await confirm.getByRole('button', { name: 'Create link' }).click();
  const shared = page.getByRole('dialog', { name: 'Shared · version 1' });
  const link = await shared.getByRole('textbox', { name: 'Link' }).inputValue();
  await shared.getByRole('button', { name: 'Done' }).click();

  await page.route('**/api/artifacts/*/versions/*/share', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const status = (await response.json()) as { share: unknown };
    await route.fulfill({ response, json: { ...status, available: false } });
  });
  await page.reload();
  await openPane(page, 'Old link');
  await old.getByRole('button', { name: 'Shared' }).click();
  await expect(shared.getByRole('textbox', { name: 'Link' })).toHaveValue(link);
  await expect(shared).toContainText('Ends ');
  await expect(shared).toContainText('The passcode was shown when the link was made.');
  await expect(shared).not.toContainText('share again.');
  await expect(shared).toContainText('Spark can’t make new links now.');

  const stopped = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && SHARE_STATUS.test(response.url()),
  );
  await shared.getByRole('button', { name: 'Stop sharing' }).click();
  expect((await stopped).status()).toBe(204);
  await expect(shared).toHaveCount(0);
  await old.getByRole('button', { name: 'Share…' }).click();
  const prompt = page.getByRole('dialog', { name: 'Connect Cloudflare to share artifacts' });
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt).toHaveCount(0);

  await page.unroute('**/api/artifacts/*/versions/*/share');
  await page.reload();
  await openPane(page, 'Old link');
  await expect(old.getByRole('button', { name: 'Share…' })).toBeVisible();
});

test('a sheet stays on its version, and keeps its passcode, when a newer version arrives', async ({
  page,
}) => {
  const status = page.waitForRequest(SHARE_STATUS);
  await publish(page, 'Live board');
  const id = SHARE_STATUS.exec((await status).url())![1]!;
  const board = pane(page, 'Live board');
  await page.getByRole('button', { name: 'Show context rail' }).click();
  await page.getByRole('button', { name: 'Open artifact Live board' }).click();
  await expect(board.getByRole('button', { name: 'Version' })).toHaveText('v1');

  await board.getByRole('button', { name: 'Share…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Share “Live board”?' });
  await confirm.getByRole('switch', { name: 'Require a passcode' }).click();
  await confirm.getByRole('button', { name: 'Create link' }).click();
  const shared = page.getByRole('dialog', { name: 'Shared · version 1' });
  const code = await shared.getByRole('textbox', { name: 'Passcode' }).inputValue();
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);

  const update = { action: 'update', id, content: '<h1>Newer</h1>' };
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(
    `#build #sparkscript ${JSON.stringify([{ tool: 'spark_artifact', args: update }])}`,
  );
  await input.press('Enter');
  await expect(page.getByRole('group', { name: 'Artifact Live board' }).last()).toContainText(
    'version 2',
    { timeout: 30_000 },
  );
  await expect(board.getByRole('button', { name: 'Version' })).toHaveText('v2');
  await expect(shared.getByRole('textbox', { name: 'Passcode' })).toHaveValue(code);

  await shared.getByRole('button', { name: 'Done' }).click();
  await expect(shared).toHaveCount(0);
  await expect(board.getByRole('button', { name: 'Share…' })).toBeFocused();
});

test('a status check that answers late does not hide the new link or its passcode', async ({
  page,
}) => {
  await publish(page, 'Slow check');
  await pane(page, 'Slow check').getByRole('button', { name: 'Share…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Share “Slow check”?' });
  await confirm.getByRole('switch', { name: 'Require a passcode' }).click();

  let answerLate = () => {};
  const held = new Promise<void>((resolve) => {
    answerLate = resolve;
  });
  await page.route('**/api/artifacts/*/versions/*/share', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await held;
    await route.fulfill({
      json: { available: true, service: 'hosted', host: null, days: [1], share: null },
    });
  });
  const recheck = page.waitForRequest(
    (request) => request.method() === 'GET' && SHARE_STATUS.test(request.url()),
  );
  await page.evaluate(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + 10 * 60_000;
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await recheck;

  await confirm.getByRole('button', { name: 'Create link' }).click();
  const shared = page.getByRole('dialog', { name: 'Shared · version 1' });
  const code = await shared.getByRole('textbox', { name: 'Passcode' }).inputValue();
  const answered = page.waitForEvent(
    'requestfinished',
    (request) => request.method() === 'GET' && SHARE_STATUS.test(request.url()),
  );
  answerLate();
  await answered;
  await expect(shared.getByRole('textbox', { name: 'Passcode' })).toHaveValue(code);
  await expect(shared.getByRole('textbox', { name: 'Link' })).toHaveValue(/\/a\//);
});

test('a sheet taller than a short window scrolls so its buttons stay reachable', async ({
  page,
}) => {
  await publish(page, 'Short window');
  await pane(page, 'Short window').getByRole('button', { name: 'Share…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Share “Short window”?' });
  await expect(confirm).toBeVisible();
  await page.setViewportSize({ width: 900, height: 240 });
  const box = (await confirm.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(240);
  expect(await confirm.evaluate((panel) => panel.scrollHeight > panel.clientHeight)).toBe(true);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
});
