import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { emitVoice, installFakeVoice, press, voiceCalls } from './fake-voice.ts';
import { continueButton, dialog, fakeFullDiskAccess } from './onboarding-flow.ts';

async function openVoiceSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Voice' }).click();
  return page.getByRole('dialog', { name: 'Voice' }).getByRole('region', { name: 'Speech model' });
}

const ops = async (page: Page) =>
  (await voiceCalls(page)).map((call) => [call.op, ...call.args].join(' '));

test('Settings: Voice shows Parakeet alone, with no picker and no remove', async ({
  page,
}, testInfo) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page, { downloaded: true });
  const card = await openVoiceSettings(page);
  await expect(card.getByText('Parakeet', { exact: true })).toBeVisible();
  await expect(card).toContainText('549 MB');
  await expect(card).toContainText('Ready');
  await expect(card.getByRole('radio')).toHaveCount(0);
  await expect(card.getByRole('button')).toHaveCount(0);
  await expect(page.getByText(/Whisper/)).toHaveCount(0);
  expect(await ops(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('speech-model-ready.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await card.screenshot({ path: testInfo.outputPath('speech-model-dark.png') });
});

test('Settings: a missing model downloads with progress', async ({ page }, testInfo) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page, { downloaded: false });
  const card = await openVoiceSettings(page);
  await expect(card.getByText('Not downloaded')).toBeVisible();
  await card.getByRole('button', { name: 'Download Parakeet, 549 MB' }).click();
  await expect(card.getByText(/Downloading \d+%/)).toBeVisible();
  await expect(card.getByRole('progressbar', { name: 'Parakeet download' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('speech-model-downloading.png') });
  await expect(card).toContainText('Ready');
  expect(await ops(page)).toEqual(['download']);
});

test('Settings: a language Parakeet doesn’t cover gets one plain line', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page, { downloaded: true, language: 'ja' });
  const card = await openVoiceSettings(page);
  await expect(card).toContainText(
    'Parakeet doesn’t cover Japanese, your Mac’s language, and may transcribe it poorly.',
  );
});

test('Settings: the Voice shortcut is recorded from the keys pressed and can be reset', async ({
  page,
}, testInfo) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Voice' }).click();
  const card = page.getByRole('dialog', { name: 'Voice' }).getByRole('region', {
    name: 'Voice shortcut',
  });
  await expect(card.getByRole('radio', { name: 'Use ⌥⇧V' })).toBeChecked();
  await expect(card.getByRole('button', { name: 'Reset Voice shortcut' })).toBeDisabled();

  await card.getByRole('button', { name: 'Change Voice shortcut' }).click();
  const recording = card.getByRole('button', { name: 'Recording Voice shortcut' });
  await expect(recording).toBeFocused();
  await expect(card).toContainText('Press the new keys, or Escape to cancel.');
  await page.keyboard.press('Alt+Space');
  await expect(card).toContainText('This shortcut already opens Quick chat.');

  await card.getByRole('button', { name: 'Change Voice shortcut' }).click();
  await page.keyboard.press('M');
  await expect(recording).toBeFocused();
  await page.keyboard.press('Control+Alt+M');
  await expect(card.getByRole('radio', { name: 'Use ⌃⌥M' })).toBeChecked();
  await expect(card).toContainText('Any modifier with a letter, number or Space.');
  await page.screenshot({ path: testInfo.outputPath('voice-shortcut.png') });

  await card.getByRole('button', { name: 'Change Voice shortcut' }).click();
  await page.keyboard.press('Escape');
  await expect(card.getByRole('radio', { name: 'Use ⌃⌥M' })).toBeChecked();

  await card.getByRole('button', { name: 'Reset Voice shortcut' }).click();
  await expect(card.getByRole('radio', { name: 'Use ⌥⇧V' })).toBeChecked();
  expect(await ops(page)).toEqual([
    'setShortcut Alt+Space',
    'setShortcut Control+Alt+M',
    'setShortcut ',
  ]);
});

test('Settings: a download can be cancelled and started again', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page, { downloaded: false, downloadStepMs: 2_000 });
  const card = await openVoiceSettings(page);
  await card.getByRole('button', { name: 'Download Parakeet, 549 MB' }).click();
  await expect(card.getByText('Downloading 0%')).toBeVisible();
  await card.getByRole('button', { name: 'Cancel Parakeet download' }).click();
  await expect(card.getByText('Not downloaded')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Download Parakeet, 549 MB' })).toBeVisible();
  expect(await ops(page)).toEqual(['download', 'cancelDownload']);
});

async function toTools(page: Page) {
  await fakeFullDiskAccess(page, 'unsupported');
  await page.goto('/');
  await expect(
    dialog(page).getByRole('heading', { name: 'Connect your AI providers' }),
  ).toBeVisible();
  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Bring in your tools' })).toBeVisible();
}

async function toVoiceStep(page: Page) {
  await toTools(page);
  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Talk to Spark' })).toBeVisible();
}

test('Onboarding: Voice offers the Parakeet download, and Not now leaves Voice off', async ({
  page,
}, testInfo) => {
  await resetTestDatabase({ onboarded: false, connected: ['claude'] });
  await installFakeVoice(page, { enabled: false, mic: 'not_determined', language: 'en' });
  await toVoiceStep(page);
  const parakeet = dialog(page).getByRole('radio', { name: /^Parakeet/ });
  await expect(parakeet).toBeChecked();
  await expect(dialog(page).getByRole('radio')).toHaveCount(2);
  await expect(dialog(page)).not.toContainText('Whisper');
  const next = dialog(page).getByRole('button', { name: 'Download 549 MB and continue' });
  await expect(next).toBeVisible();
  await expect(dialog(page)).toContainText('macOS asks for the microphone when you continue.');
  await expect(dialog(page).locator('.pane')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('onboarding-voice.png') });
  await dialog(page)
    .getByRole('radio', { name: /^Not now/ })
    .check();
  await expect(continueButton(page)).toBeVisible();
  await dialog(page)
    .getByRole('radio', { name: /^Parakeet/ })
    .check();
  await next.click();
  await expect(dialog(page).getByRole('heading', { name: "You're all set, Test" })).toBeVisible();
  expect(await ops(page)).toEqual(['turnOn']);
  await dialog(page).getByRole('button', { name: 'Back' }).click();
  await dialog(page)
    .getByRole('radio', { name: /^Not now/ })
    .check();
  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: "You're all set, Test" })).toBeVisible();
  expect(await ops(page)).toEqual(['turnOn', 'turnOff']);
});

test('Onboarding: Not now alone leaves Voice off', async ({ page }) => {
  await resetTestDatabase({ onboarded: false, connected: ['claude'] });
  await installFakeVoice(page, { enabled: false, language: 'en' });
  await toVoiceStep(page);
  await dialog(page)
    .getByRole('radio', { name: /^Not now/ })
    .check();
  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: "You're all set, Test" })).toBeVisible();
  expect(await ops(page)).toEqual([]);
});

test('Onboarding has no Voice step without the Mac app', async ({ page }) => {
  await resetTestDatabase({ onboarded: false, connected: ['claude'] });
  await toTools(page);
  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: "You're all set, Test" })).toBeVisible();
});

test('the island shows the words as they are heard, then matches only the final text', async ({
  page,
}, testInfo) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  const island = page.getByRole('region', { name: 'Spark Island' });
  await expect(island).toBeVisible();
  const listen = await press(page);
  await emitVoice(page, { kind: 'speech', id: listen.id });
  await emitVoice(page, { kind: 'partial', id: listen.id, text: 'who knees' });
  const live = island.getByTestId('speech-live');
  await expect(live).toHaveText('who knees');
  await expect(live).toHaveAttribute('aria-hidden', 'true');
  await emitVoice(page, { kind: 'partial', id: listen.id, text: 'who needs me' });
  await expect(live).toHaveText('who needs me');
  await expect(island.getByText('Listening… Esc to cancel')).toBeVisible();
  await island.screenshot({ path: testInfo.outputPath('island-live-words.png') });
  await emitVoice(page, { kind: 'final', id: listen.id, text: 'Who needs me?', reason: 'paused' });
  await expect(live).toHaveCount(0);
  await expect(island.getByRole('textbox', { name: 'Ask Spark' })).toHaveValue('Who needs me');
});
