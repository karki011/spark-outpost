import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { asPairedPhone } from './outposts-kit.ts';
import { openChats } from './navigation.ts';
import { pickerPanel } from './permissions-kit.ts';
import { resetWithAgents } from './project-chat-kit.ts';
import { expandSection } from './provider-screen.ts';
import { animationsSettled } from './settle.ts';

const SHOTS = process.env.SPARK_NO_AUTO_SHOTS ?? '';

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
  await page.setViewportSize({ width: 1400, height: 900 });
});

const pickerButton = (page: Page) => page.getByRole('button', { name: /^Model and effort/ });
const claudeModels = (page: Page) =>
  pickerPanel(page).getByRole('radiogroup', { name: 'Claude model' });

async function newChat(page: Page): Promise<void> {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
}

async function expectPicked(page: Page, model: string): Promise<void> {
  await expect(pickerButton(page)).toHaveAccessibleName(`Model and effort: ${model}`);
  await pickerButton(page).click();
  const models = claudeModels(page);
  await expect(models.getByRole('radio', { name: /^Auto/ })).toHaveCount(0);
  await expect(models).not.toContainText('The agent’s default model');
  await expect(models.getByRole('radio', { checked: true })).toHaveCount(1);
  await expect(models.getByRole('radio', { name: new RegExp(`^${model}`) })).toHaveAttribute(
    'aria-checked',
    'true',
  );
}

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await animationsSettled(page);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function pickSettingsDefault(page: Page, model: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const claude = providers.locator('.pconf[data-prov="claude"]');
  await providers.locator('.ptile[data-prov="claude"]').click();
  await expandSection(claude, 'Defaults for new chats');
  await expect(claude).not.toContainText('Auto, which');
  await claude.getByRole('button', { name: 'Claude model' }).click();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/providers/claude/defaults') && response.ok(),
  );
  await page.getByRole('menuitemradio', { name: new RegExp(`^${model}`) }).click();
  await saved;
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(providers).toBeHidden({ timeout: 500 });
  }).toPass();
}

test('a new chat shows the model it will run, checked, with no Auto', async ({ page }) => {
  await newChat(page);
  await expectPicked(page, 'Opus 5.5');
  await shoot(page, 'picker-open');

  const sonnet = claudeModels(page).getByRole('radio', { name: /^Sonnet 5/ });
  await sonnet.click();
  await expect(pickerButton(page)).toHaveAccessibleName('Model and effort: Sonnet 5');
  await expect(sonnet).toHaveAttribute('aria-checked', 'true');
  await expect(claudeModels(page).getByRole('radio', { checked: true })).toHaveCount(1);
});

test('the Settings default is the model new chats start on', async ({ page }) => {
  await newChat(page);
  await expect(pickerButton(page)).toHaveAccessibleName('Model and effort: Opus 5.5');
  await pickSettingsDefault(page, 'Haiku 4.5');
  await expect(pickerButton(page)).toHaveAccessibleName('Model and effort: Haiku 4.5');
  await newChat(page);
  await expectPicked(page, 'Haiku 4.5');
  await page.keyboard.press('Escape');

  await pickSettingsDefault(page, 'Sonnet 5');
  await newChat(page);
  await expectPicked(page, 'Sonnet 5');
});

test('the next Home draft after a send keeps following the Settings default', async ({ page }) => {
  await page.goto('/');
  await pickSettingsDefault(page, 'Opus 5.5');
  const composer = page.getByRole('region', { name: 'Start a new chat' });
  const picker = composer.getByRole('button', { name: /^Model and effort/ });
  await expect(picker).toHaveAccessibleName('Model and effort: Opus 5.5');
  const input = composer.getByRole('textbox', { name: 'Message' });
  await input.fill('Say hello');
  await input.press('Enter');
  await expect(composer.getByRole('status')).toContainText('Started ‘Say hello’');

  await pickSettingsDefault(page, 'Sonnet 5');
  await expect(picker).toHaveAccessibleName('Model and effort: Sonnet 5');
});

test('a paired device shows the same model and no Auto', async ({ page }) => {
  await asPairedPhone(page);
  await newChat(page);
  await expectPicked(page, 'Opus 5.5');
});
