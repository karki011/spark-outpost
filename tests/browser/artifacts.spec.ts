import { expect, test, type Page } from '@playwright/test';
import { openChats } from './navigation.ts';
import { permissionChip, pickMode } from './permissions-kit.ts';
import { resetWithAgents } from './project-chat-kit.ts';
import { API_PORT } from './stub-config.ts';

test.beforeEach(async () => {
  test.slow();
  await resetWithAgents();
});

const probe = (label: string) =>
  `<h1>${label}</h1><script>fetch("http://127.0.0.1:${API_PORT}/api/health").then(() => { document.body.dataset.api = "reached"; }, () => { document.body.dataset.api = "blocked"; }); try { document.body.dataset.cookie = String(document.cookie.length); } catch { document.body.dataset.cookie = "denied"; }</script>`;

function artifactCall(args: Record<string, unknown>): string {
  return `#build #sparkscript ${JSON.stringify([{ tool: 'spark_artifact', args }])}`;
}

async function send(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

const VIEW = /\/api\/artifacts\/([0-9a-f-]{36})\/versions\/\d+\/view$/;

test('an agent publishes an artifact that opens beside the chat, sandboxed, with versions @packaged', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await permissionChip(page).click();
  await pickMode(page, 'Auto');
  await page.keyboard.press('Escape');

  await send(
    page,
    artifactCall({
      action: 'publish',
      title: 'CPI dashboard',
      kind: 'html',
      content: probe('CPI'),
    }),
  );
  const first = page.getByRole('group', { name: 'Artifact CPI dashboard' });
  await expect(first).toContainText('Artifact · HTML · version 1', { timeout: 30_000 });

  const viewed = page.waitForResponse((response) => VIEW.test(response.url()));
  await first.getByRole('button', { name: 'Open' }).click();
  const id = VIEW.exec((await viewed).url())![1]!;
  const pane = page.getByRole('region', { name: 'Artifact CPI dashboard' });
  await expect(pane).toBeVisible();
  const frame = pane.locator('iframe.art-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  const inside = page.frameLocator('iframe.art-frame');
  await expect(inside.getByRole('heading', { name: 'CPI' })).toBeVisible();
  await expect(inside.locator('body')).toHaveAttribute('data-api', 'blocked');
  await expect(inside.locator('body')).toHaveAttribute('data-cookie', 'denied');
  await expect(pane).toContainText('Sandboxed · no network · no access to Spark');

  await send(page, artifactCall({ action: 'update', id, content: probe('CPI v2') }));
  await expect(page.getByRole('group', { name: 'Artifact CPI dashboard' }).last()).toContainText(
    'version 2',
    { timeout: 30_000 },
  );
  await page
    .getByRole('group', { name: 'Artifact CPI dashboard' })
    .last()
    .getByRole('button', { name: 'Open' })
    .click();
  await expect(inside.getByRole('heading', { name: 'CPI v2' })).toBeVisible();

  const versions = pane.getByRole('button', { name: 'Version' });
  await expect(versions).toHaveText('v2');
  await versions.click();
  await page.getByRole('menuitemradio', { name: 'v1' }).click();
  await expect(versions).toHaveText('v1');
  await expect(inside.getByRole('heading', { name: 'CPI', exact: true })).toBeVisible();

  await pane.getByRole('button', { name: 'Copy' }).click();
  await expect(pane.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(probe('CPI'));

  const download = page.waitForEvent('download');
  await pane.getByRole('button', { name: 'Save as…' }).click();
  const dl = await download;
  expect(dl.suggestedFilename()).toBe('CPI dashboard.html');

  await pane.getByRole('button', { name: 'Close artifact' }).click();
  await expect(pane).toHaveCount(0);
});

test('a Markdown artifact renders as text and an SVG one as an image', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await permissionChip(page).click();
  await pickMode(page, 'Auto');
  await page.keyboard.press('Escape');

  await send(
    page,
    artifactCall({
      action: 'publish',
      title: 'Notes',
      kind: 'markdown',
      content: '# Plan\n\n- one',
    }),
  );
  await page
    .getByRole('group', { name: 'Artifact Notes' })
    .getByRole('button', { name: 'Open' })
    .click({ timeout: 30_000 });
  const notes = page.getByRole('region', { name: 'Artifact Notes' });
  await expect(notes.getByRole('heading', { name: 'Plan' })).toBeVisible();
  await expect(notes.locator('iframe')).toHaveCount(0);

  await send(
    page,
    artifactCall({
      action: 'publish',
      title: 'Logo',
      kind: 'svg',
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>x()</script></svg>',
    }),
  );
  await page
    .getByRole('group', { name: 'Artifact Logo' })
    .getByRole('button', { name: 'Open' })
    .click({ timeout: 30_000 });
  const logo = page.getByRole('region', { name: 'Artifact Logo' });
  await expect(logo.getByRole('img', { name: 'Logo' })).toBeVisible();
  await expect(logo.locator('svg script')).toHaveCount(0);
});

test('in Manual an artifact waits for Show it, then its card appears without a reload', async ({
  page,
}) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await permissionChip(page).click();
  await pickMode(page, 'Manual');
  await page.keyboard.press('Escape');

  await send(
    page,
    artifactCall({ action: 'publish', title: 'Chart', kind: 'markdown', content: '# Chart' }),
  );
  const show = page.getByRole('button', { name: 'Show it' });
  await expect(show).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('group', { name: 'Artifact Chart' })).toHaveCount(0);
  await show.click();
  await expect(page.getByRole('group', { name: 'Artifact Chart' })).toContainText(
    'Artifact · Markdown · version 1',
    { timeout: 30_000 },
  );
});
