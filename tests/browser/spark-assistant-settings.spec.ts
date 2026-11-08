import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

async function openSection(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: /Spark assistant/ })
    .click();
  return page.getByRole('dialog', { name: 'Spark assistant' });
}

async function pick(page: Page, picker: string, choice: RegExp) {
  await page.getByRole('button', { name: picker }).click();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/spark-assistant/settings') && response.ok(),
  );
  await page
    .getByRole('menu', { name: picker })
    .getByRole('menuitemradio', { name: choice })
    .click();
  await saved;
}

test('Spark assistant starts on the fast model and keeps the provider, model and effort picked', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
  const section = await openSection(page);
  const model = section.getByRole('button', { name: 'Ask Spark model' });
  await expect(section.getByRole('button', { name: 'Ask Spark provider' })).toHaveText(
    'Same as default chat provider',
  );
  await expect(model).toHaveText('Fast (recommended)');
  await expect(
    section.getByText('Claude offers no faster model here, so Ask Spark uses its default model.'),
  ).toBeVisible();

  await pick(page, 'Ask Spark provider', /^Codex/);
  await expect(section.getByText('Ask Spark answers with GPT-6 Luna.')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Ask Spark effort' })).toHaveText(
    'Fast default (medium)',
  );
  await expect(section.getByText('Ask Spark thinks at medium effort.')).toBeVisible();

  await pick(page, 'Ask Spark effort', /^high/);
  await expect(section.getByText('Ask Spark thinks at high effort.')).toBeVisible();

  await page.reload();
  const again = await openSection(page);
  await expect(again.getByRole('button', { name: 'Ask Spark provider' })).toHaveText('Codex');
  await expect(again.getByRole('button', { name: 'Ask Spark effort' })).toHaveText('high');
  const saved = await (await page.request.get('/api/spark-assistant/settings')).json();
  expect(saved.settings).toEqual({
    provider: 'codex',
    modelChoice: 'fast',
    model: null,
    effort: 'high',
    acts: 'manual',
  });
  await expect(again.getByText('None yet. Say “remember …” to add one.')).toBeVisible();
});

test('Clear history asks first and offers to clear the key facts too', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  await page.request.post('/api/spark-assistant', { data: {} });
  const section = await openSection(page);
  await expect(section.getByText('No session yet. The next question starts one.')).toBeVisible();

  await section.getByRole('button', { name: 'Clear history…' }).click();
  const facts = section.getByRole('switch', { name: 'Also clear key facts' });
  await expect(facts).not.toBeChecked();
  await section.getByRole('button', { name: 'Cancel' }).click();
  await expect(facts).toHaveCount(0);

  await section.getByRole('button', { name: 'Clear history…' }).click();
  const cleared = page.waitForResponse(
    (response) => response.url().endsWith('/api/spark-assistant/clear') && response.ok(),
  );
  await section.getByRole('button', { name: 'Clear history', exact: true }).click();
  await cleared;
  const events = await (await page.request.get('/api/spark-assistant/events')).json();
  expect(events.events).toMatchObject([{ kind: 'history_cleared' }]);
});

test('View conversation opens the hidden Ask Spark chat read-only', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  await page.request.post('/api/spark-assistant', { data: {} });
  const section = await openSection(page);
  await section.getByRole('button', { name: 'View conversation' }).click();
  await expect(section).toHaveCount(0);
  const activity = page.getByRole('region', { name: 'Ask Spark activity' });
  await expect(activity).toContainText('Ask Spark’s conversation is read-only here.');
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
});
