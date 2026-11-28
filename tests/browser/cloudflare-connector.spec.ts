import { expect, test, type Page } from '@playwright/test';
import { CLOUDFLARE_PROBLEMS } from '../../packages/contracts/src/index.ts';
import { connectorCard, connectorHead, connectorStatus } from './connector-cards.ts';
import { openChats } from './navigation.ts';
import { permissionChip, pickMode } from './permissions-kit.ts';
import { resetWithAgents } from './project-chat-kit.ts';
import { clickSettings } from './rail-menu.ts';
import { OWN_SHARE_HOST, OWN_SHARE_UPLOAD_KEY } from './stub-config.ts';

test.beforeEach(async () => {
  test.slow();
  await resetWithAgents();
});

const card = (page: Page) => connectorCard(page, 'cloudflare');

async function openCard(page: Page) {
  await clickSettings(page);
  await page.getByRole('tab', { name: 'Connectors' }).click();
  await connectorHead(card(page)).click();
}

async function publish(page: Page, title: string) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await permissionChip(page).click();
  await pickMode(page, 'Auto');
  await page.keyboard.press('Escape');
  const args = { action: 'publish', title, kind: 'html', content: '<h1>Own</h1>' };
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(`#build #sparkscript ${JSON.stringify([{ tool: 'spark_artifact', args }])}`);
  await input.press('Enter');
  await page
    .getByRole('group', { name: `Artifact ${title}` })
    .getByRole('button', { name: 'Open' })
    .click({ timeout: 30_000 });
}

test('the user connects their own share service, shares from it and disconnects @packaged', async ({
  page,
}) => {
  await page.goto('/');
  await openCard(page);
  const cloudflare = card(page);
  await expect(cloudflare.getByRole('heading', { name: 'What you need' })).toBeVisible();
  await expect(cloudflare.getByRole('link', { name: /^Create a free account/ })).toHaveAttribute(
    'href',
    'https://dash.cloudflare.com/sign-up',
  );
  await expect(cloudflare.getByRole('link', { name: /^Deploy to Cloudflare/ })).toHaveAttribute(
    'href',
    /^https:\/\/deploy\.workers\.cloudflare\.com\//,
  );

  const connect = cloudflare.getByRole('button', { name: 'Connect' });
  await expect(connect).toBeDisabled();
  await cloudflare.getByLabel('Service address').fill(`http://${OWN_SHARE_HOST}/path`);
  await expect(cloudflare).toContainText(CLOUDFLARE_PROBLEMS.address);
  await cloudflare.getByLabel('Service address').fill(`http://${OWN_SHARE_HOST}`);
  await cloudflare.getByLabel('Upload key').fill('x'.repeat(40));
  await connect.click();
  await expect(cloudflare.getByRole('alert')).toHaveText(CLOUDFLARE_PROBLEMS.refused);

  await cloudflare.getByLabel('Upload key').fill(OWN_SHARE_UPLOAD_KEY);
  await connect.click();
  await expect(cloudflare.locator('.cf-ok')).toHaveText('Connected');
  await expect(connectorStatus(cloudflare)).toHaveText(OWN_SHARE_HOST);
  await expect(cloudflare.locator('.cf-host')).toHaveText(OWN_SHARE_HOST);
  await expect(
    cloudflare.getByRole('switch', { name: 'Share artifacts from this account' }),
  ).toHaveAttribute('aria-checked', 'true');
  expect(await page.content()).not.toContain(OWN_SHARE_UPLOAD_KEY);
  await cloudflare.getByRole('button', { name: 'Check again' }).click();
  await expect(cloudflare.getByRole('note')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await publish(page, 'Own page');
  const pane = page.getByRole('region', { name: 'Artifact Own page' });
  await pane.getByRole('button', { name: 'Share…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Share “Own page”?' });
  await expect(confirm).toContainText('Your Cloudflare account');
  await expect(confirm).toContainText(OWN_SHARE_HOST);
  const ends = confirm.getByRole('button', { name: 'Link ends after' });
  await expect(ends).toHaveText('7 days');
  await ends.click();
  const choices = page.getByRole('menu', { name: 'Link ends after' });
  await expect(choices.getByRole('menuitemradio')).toHaveText(['1 day', '7 days']);
  await expect(choices.getByRole('menuitemradio', { name: '7 days' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(ends).toHaveText('1 day');
  await expect(ends).toBeFocused();
  await confirm.getByRole('button', { name: 'Create link' }).click();
  const shared = page.getByRole('dialog', { name: 'Shared · version 1' });
  await expect(shared.getByRole('textbox', { name: 'Link' })).toHaveValue(
    new RegExp(`^http://${OWN_SHARE_HOST}/a/`),
  );
  await shared.getByRole('button', { name: 'Done' }).click();

  await openCard(page);
  await expect(cloudflare.getByText('Pages shared now').locator('+ dd')).toHaveText('1');
  await cloudflare.getByRole('button', { name: 'Disconnect…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Disconnect Cloudflare?' });
  await expect(dialog).toContainText(
    'Pages already shared stay up until they expire or you stop sharing them.',
  );
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(cloudflare.getByLabel('Service address')).toBeVisible();
  await expect(cloudflare.getByLabel('Upload key')).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
});
