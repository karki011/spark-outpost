import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FAKE_CODEX_MODES } from '../../apps/server/src/providers/fake.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { shoot, useSystemTheme } from './docs-seed.ts';
import { openChats } from './navigation.ts';
import { expandSection } from './provider-screen.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const SOL_61 = { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', description: 'Newest' };
const MODELS = [
  { id: 'gpt-6-luna', label: '6 Luna', description: 'Fast' },
  SOL_61,
  { id: 'gpt-6-sol', label: '6 Sol', description: 'Workhorse' },
];
const SWITCHED = "Your ChatGPT sign-in can't use GPT-6.1 Sol, so this turn ran on 6 Sol instead.";
const RAW = 'invalid_request_error';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21aa'];

interface Seed {
  models?: typeof MODELS;
  rejected?: boolean;
}

async function seedCodex({ models = MODELS, rejected = false }: Seed = {}): Promise<void> {
  await resetTestDatabase({ onboarded: true, connected: ['codex'] });
  const db = openTestDb();
  try {
    const efforts = ['low', 'medium', 'high'].map((id) => ({ id, label: id, description: null }));
    await db.query(
      `INSERT INTO provider_capabilities
         (workspace_id, provider, models, efforts, default_model, modes, default_mode)
       SELECT workspace_id, 'codex', $1, $2, 'gpt-6-sol', $3, 'agent' FROM provider_connections`,
      [JSON.stringify(models), JSON.stringify(efforts), JSON.stringify(FAKE_CODEX_MODES)],
    );
    await db.query(
      `INSERT INTO provider_model_access
         (workspace_id, provider, method, account_kind, account_label, account_plan, listed,
          rejected, reported_at)
       SELECT workspace_id, 'codex', 'cli', 'account', 'ChatGPT Plus', 'plus', $1, $2, now()
       FROM provider_connections`,
      [
        JSON.stringify(models.map((model) => model.id)),
        JSON.stringify(
          rejected ? [{ id: SOL_61.id, label: SOL_61.label, at: new Date().toISOString() }] : [],
        ),
      ],
    );
    await db.query(`UPDATE provider_connections SET model = $1`, [SOL_61.id]);
  } finally {
    await db.end();
  }
}

async function capture(page: Page, name: string, target?: Locator): Promise<void> {
  if (SHOTS) await shoot(page, SHOTS, name, target);
}

async function ask(page: Page, text: string): Promise<void> {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const picker = page.getByRole('button', { name: /^Model and effort/ });
  await expect(picker).toHaveAccessibleName('Model and effort: Auto');
  await picker.click();
  await page
    .getByRole('dialog', { name: 'Model, effort, and permissions' })
    .getByRole('radio', { name: /GPT-6\.1 Sol/ })
    .click();
  await expect(picker).toHaveAccessibleName('Model and effort: GPT-6.1 Sol');
  await page.keyboard.press('Escape');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('a rejected model is retried on the nearest usable one and the chat says so', async ({
  page,
}) => {
  await seedCodex();
  await ask(page, 'Hello from a ChatGPT account');

  await expect(page.locator('.md', { hasText: 'You wrote: "Hello from a ChatGPT' })).toBeVisible({
    timeout: 15_000,
  });
  const note = page.locator('.model-switch-note');
  await expect(note).toContainText(SWITCHED);
  await expect(page.locator('.error-line')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(RAW);
  await capture(page, 'chat-message', page.locator('.thread, main').first());

  await page.reload();
  await expect(page.locator('.model-switch-note')).toContainText(SWITCHED);

  const picker = page.getByRole('button', { name: /^Model and effort/ });
  await expect(picker).toHaveAccessibleName('Model and effort: GPT-6.1 Sol (unavailable)');
  await picker.click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  const notice = panel.getByRole('status');
  await expect(notice).toContainText("Your ChatGPT sign-in can't use GPT-6.1 Sol.");
  await expect(panel.getByRole('radio', { name: /GPT-6\.1 Sol/ })).toContainText('Unavailable');
  const scan = await new AxeBuilder({ page }).include('.mpop.picker').withTags(WCAG).analyze();
  expect(scan.violations).toEqual([]);
  await capture(page, 'picker', panel);

  await notice.getByRole('button', { name: 'Switch to 6 Sol' }).click();
  await expect(picker).toHaveAccessibleName('Model and effort: 6 Sol');
  await expect(panel.getByRole('status')).toHaveCount(0);
  await expect(panel.getByRole('radio', { name: /GPT-6\.1 Sol/ })).toHaveCount(0);
  await expect(panel.getByRole('radio', { name: /6 Luna/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page
    .locator('.model-switch-note')
    .getByRole('button', { name: /Models/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Models' })).toBeVisible();
});

test('a default the sign-in cannot use is flagged on the provider screen with a one-click fix', async ({
  page,
}) => {
  await seedCodex({ rejected: true });
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  await providers.locator('.ptile[data-prov="codex"]').click();
  const codex = providers.locator('.pconf[data-prov="codex"]');

  await expandSection(codex, 'How to connect');
  await expect(codex).toContainText('ChatGPT Plus');
  await expect(codex).toContainText('2 usable, 1 unavailable (GPT-6.1 Sol)');

  await expandSection(codex, 'Defaults for new chats');
  await expect(codex.getByRole('region', { name: 'Defaults for new chats' })).toContainText(
    "New chats start on Auto, which runs this model, or the agent's own default when none is picked here.",
  );
  const notice = codex.getByRole('status').filter({ hasText: 'default model' });
  await expect(notice).toContainText(
    "Your ChatGPT sign-in can't use GPT-6.1 Sol. It is your default model.",
  );
  const scan = await new AxeBuilder({ page })
    .include('.pconf[data-prov="codex"]')
    .withTags(WCAG)
    .analyze();
  expect(scan.violations).toEqual([]);
  await capture(page, 'unavailable-default', codex);

  await notice.getByRole('button', { name: 'Switch to 6 Sol' }).click();
  await expect(codex.getByRole('status').filter({ hasText: 'default model' })).toHaveCount(0);
  await expect(codex.getByRole('button', { name: 'Codex model' })).toContainText('6 Sol');
});

test('with nothing to switch to, the turn stops in plain words and keeps the raw reply folded away', async ({
  page,
}) => {
  await seedCodex({ models: [SOL_61] });
  await ask(page, 'Hello with one model');

  const error = page.locator('.error-line');
  await expect(error).toContainText(
    "Your ChatGPT sign-in can't use GPT-6.1 Sol. Pick another model in Settings > Models, then send the message again.",
    { timeout: 15_000 },
  );
  await expect(error).not.toContainText(RAW);
  const details = page.locator('.error-details');
  await expect(details.locator('pre')).toBeHidden();
  await details.getByText('Details from the provider').click();
  await expect(details.locator('pre')).toContainText(
    "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
  );
  await capture(page, 'chat-error-details', page.locator('.thread, main').first());
});

test.describe('screenshots', () => {
  test.skip(!SHOTS, 'Set SPARK_SHOTS to a folder to write the screenshots.');
  test('writes to the folder', () => {
    expect(path.isAbsolute(SHOTS)).toBe(true);
  });
});
