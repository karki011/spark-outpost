import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  desktopCalls,
  fakeUpdater,
  pushUpdate,
  railShot,
  relaunchWith,
  setRuns,
  shot,
} from './fake-updater.ts';

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test('Settings shows the version, channel, automatic downloads and Check now', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });

  await expect(updates).toContainText('Spark Outpost 0.2.0');
  await expect(updates).toContainText('Not checked yet.');
  await expect(updates.getByRole('link', { name: 'Release notes' })).toHaveAttribute(
    'href',
    'https://updates.example.com/spark/release-notes.html',
  );
  await updates.getByRole('radio', { name: 'Beta' }).click();
  await expect(updates.getByRole('radio', { name: 'Beta' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const auto = updates.getByRole('switch', { name: 'Download updates automatically' });
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-checked', 'false');
  await expect(updates).toContainText('downloads one when you ask');

  await updates.getByRole('button', { name: 'Check now' }).click();
  await expect(updates).toContainText('Last checked just now.');
  await expect(updates).toContainText("You're up to date.");
  await shot(page, 'settings');

  await pushUpdate(page, { phase: 'downloading', availableVersion: '0.3.0', progress: 42 });
  await expect(updates).toContainText('Downloading 0.3.0… 42%');
  await expect(updates.getByRole('button', { name: 'Checking…' })).toHaveCount(0);
  await expect(updates.getByRole('button', { name: 'Check now' })).toBeDisabled();
  await expect(rail(page).getByRole('button', { name: /0\.3\.0/ })).toHaveCount(0);

  expect(await desktopCalls(page)).toEqual([
    ['channel', 'beta'],
    ['autoDownload', false],
    ['check'],
  ]);
});

test('beta builds show a Beta label next to the version', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, { currentVersion: '0.1.0-beta.1', channel: 'beta' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });
  await expect(updates.locator('.upd-version')).toHaveText('Spark Outpost 0.1.0-beta.1Beta');
  await expect(updates.getByRole('radio', { name: 'Beta' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('the update blob goes from available through downloading to ready and installing', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, { autoDownload: false });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(rail(page).locator('.upd-blob')).toHaveCount(0);

  await pushUpdate(page, { phase: 'available', availableVersion: '0.3.0' });
  const available = rail(page).getByRole('button', {
    name: 'Update ready to download · click to get it (Spark Outpost 0.3.0)',
  });
  await expect(available).toBeVisible();
  await expect(available).toHaveAttribute('data-fill', '0');
  await available.hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'Update ready to download · click to get it',
  );
  await shot(page, 'available');

  await available.click();
  const downloading = rail(page).getByRole('button', { name: /Getting Spark Outpost 0\.3\.0/ });
  await expect(downloading).toHaveText('0%');
  await pushUpdate(page, { progress: 64 });
  await expect(downloading).toHaveText('64%');
  await expect(downloading).toHaveAttribute('aria-busy', 'true');
  await expect(downloading).toHaveAttribute('data-fill', '64');
  await shot(page, 'downloading');

  await pushUpdate(page, { phase: 'ready', progress: 100, installRequested: false });
  const ready = rail(page).getByRole('button', {
    name: 'Restart to update (Spark Outpost 0.3.0)',
  });
  await expect(ready).toHaveText('Restart');
  await expect(ready).not.toHaveAttribute('data-fill');
  await expect(ready.locator('.upd-blob-dot')).toBeVisible();
  await expect(page.locator('.upd-toasts').getByRole('status')).toContainText(
    'Spark Outpost 0.3.0 is ready.',
  );
  await shot(page, 'ready');

  await ready.click();
  const waiting = rail(page).getByRole('button', {
    name: 'Spark will update when your work finishes. (Spark Outpost 0.3.0)',
  });
  await expect(waiting).toHaveText('Waiting');
  await expect(
    page.locator('.upd-toasts').getByRole('status').filter({ hasText: 'when your work finishes' }),
  ).toBeVisible();
  await shot(page, 'waiting');

  await setRuns(page, 0);
  await waiting.click();
  const installing = rail(page).getByRole('button', {
    name: 'Installing Spark Outpost 0.3.0 and restarting',
  });
  await expect(installing).toHaveText('Installing…');
  await expect(installing).toBeDisabled();
  await shot(page, 'restarting');

  expect(await desktopCalls(page)).toEqual([['install'], ['install'], ['install']]);
});

test('the ready toast appears once per version', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, { phase: 'ready', availableVersion: '0.3.0', progress: 100 });
  await page.goto('/');
  const toast = page.locator('.upd-toasts').getByRole('status');
  await expect(toast).toContainText('Spark Outpost 0.3.0 is ready.');
  await page.reload();
  await expect(rail(page).getByRole('button', { name: /Restart to update/ })).toBeVisible();
  await expect(page.getByText('Spark Outpost 0.3.0 is ready.')).toHaveCount(0);
});

test('a stalled install goes back to Restart to update and says why', async ({ page }) => {
  const stalled =
    "The update didn't start. Quit Spark and open it again, or try Restart to update once more.";
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, { phase: 'installing', availableVersion: '0.3.0', progress: 100 });
  await page.goto('/');
  await expect(rail(page).getByRole('button', { name: /^Installing/ })).toBeDisabled();

  await pushUpdate(page, { phase: 'ready', error: stalled });
  const ready = rail(page).getByRole('button', {
    name: `Restart to update (Spark Outpost 0.3.0) · ${stalled}`,
  });
  await expect(ready).toBeEnabled();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });
  await expect(updates).toContainText(`0.3.0 is ready. ${stalled}`);
  await expect(updates.getByRole('button', { name: 'Restart to update' })).toBeEnabled();
});

test('a newer version found at restart replaces the staged one on the blob and in Settings', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, { phase: 'installing', availableVersion: '0.3.0', progress: 100 });
  await page.goto('/');
  await expect(
    rail(page).getByRole('button', { name: 'Installing Spark Outpost 0.3.0 and restarting' }),
  ).toBeDisabled();

  await pushUpdate(page, {
    phase: 'downloading',
    availableVersion: '0.4.0',
    progress: 0,
    installRequested: true,
  });
  const downloading = rail(page).getByRole('button', { name: /Getting Spark Outpost 0\.4\.0/ });
  await expect(downloading).toHaveText('0%');
  await expect(rail(page).getByRole('button', { name: /0\.3\.0/ })).toHaveCount(0);
  await pushUpdate(page, { progress: 40 });
  await expect(downloading).toHaveAttribute('data-fill', '40');

  await pushUpdate(page, { phase: 'installing', progress: 100 });
  await expect(
    rail(page).getByRole('button', { name: 'Installing Spark Outpost 0.4.0 and restarting' }),
  ).toBeDisabled();

  await pushUpdate(page, { phase: 'ready', installRequested: false });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });
  await expect(updates).toContainText('0.4.0 is ready.');
  await expect(updates).not.toContainText('0.3.0');
});

test('the dev copy shows its version, says it never updates and has no blob', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, {
    currentVersion: '0.0.0',
    phase: 'off',
    offReason: 'dev',
    availableVersion: '9.9.9',
    releaseNotesUrl: null,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });
  await expect(updates).toContainText('This dev copy never updates.');
  await expect(updates.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  await expect(updates.getByRole('radiogroup', { name: 'Update channel' })).toHaveCount(0);
  await expect(rail(page).locator('.upd-blob')).toHaveCount(0);
  await expect(updates.getByRole('button', { name: 'Preview the update flow' })).toHaveCount(0);
});

test('the dev app starts the update preview from Settings', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, {
    currentVersion: '0.1.0-beta.1',
    phase: 'off',
    offReason: 'dev',
    devBuild: true,
    releaseNotesUrl: null,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });
  const start = updates.getByRole('button', { name: 'Preview the update flow' });
  await expect(start).toBeVisible();
  await start.click();
  await expect(start).toHaveCount(0);
  await expect(updates.getByRole('radiogroup', { name: 'Update channel' })).toBeVisible();
  expect(await desktopCalls(page)).toEqual([['preview']]);
});

test('the browser build has no Updates section and no update blob', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('tab', { name: 'Reset' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Updates' })).toHaveCount(0);
  await expect(page.locator('.upd-blob')).toHaveCount(0);
  await expect(rail(page).getByRole('button', { name: /^App version/ })).toHaveCount(0);
});

const PREVIEW = {
  currentVersion: '0.1.0-beta.1',
  channel: 'beta',
  autoDownload: false,
  devBuild: true,
  preview: true,
  releaseNotesUrl: null,
};

const blob = (page: Page) => rail(page).locator('.upd-blob');
const toasts = (page: Page) => page.locator('.upd-toasts').getByRole('status');

async function hoverTip(page: Page, text: string) {
  await page.mouse.move(640, 300);
  await blob(page).hover();
  await expect(page.getByRole('tooltip')).toContainText(text);
}

async function startPreview(page: Page, runs = 0) {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, PREVIEW);
  await page.goto('/');
  await setRuns(page, runs);
  await expect(rail(page).getByRole('button', { name: 'Settings' })).toBeVisible();
  await pushUpdate(page, { phase: 'available', availableVersion: '0.1.0-beta.2' });
  await expect(blob(page)).toHaveAttribute('data-fill', '0');
}

async function downloadToReady(page: Page) {
  await blob(page).click();
  for (const percent of [9, 22, 47, 51, 79, 97]) {
    await pushUpdate(page, { progress: percent });
    await expect(blob(page)).toHaveText(`${percent}%`);
    await expect(blob(page)).toHaveAttribute('data-fill', String(percent));
  }
  await pushUpdate(page, { phase: 'ready', progress: 100, installRequested: false });
  await expect(blob(page)).toHaveAccessibleName('Restart to update (Spark Outpost 0.1.0-beta.2)');
}

test.describe('update preview flow', () => {
  test.use({ deviceScaleFactor: 2 });

  test('the preview goes gray, fills, turns coloured, installs and celebrates after relaunch', async ({
    page,
  }) => {
    await startPreview(page);
    await expect(blob(page)).toHaveText('Update');
    await expect(blob(page).locator('.scout')).toHaveClass(/filling/);
    await hoverTip(page, 'Update ready to download · click to get it');
    await railShot(page, 'preview-gray');

    await blob(page).click();
    await pushUpdate(page, { progress: 51 });
    await expect(blob(page)).toHaveAttribute('data-fill', '51');
    await expect(blob(page)).toHaveClass(/downloading/);
    await expect(blob(page)).toHaveText('51%');
    await hoverTip(page, 'Getting Spark Outpost 0.1.0-beta.2: 51%');
    await railShot(page, 'preview-half');

    await pushUpdate(page, { progress: 97 });
    await pushUpdate(page, { phase: 'ready', progress: 100, installRequested: false });
    await expect(blob(page)).toHaveText('Restart');
    await expect(blob(page).locator('.scout')).not.toHaveClass(/filling/);
    await expect(blob(page).locator('.scout')).toHaveClass(/happy/);
    await hoverTip(page, 'Restart to update');
    await railShot(page, 'preview-full');

    await blob(page).click();
    await expect(blob(page)).toHaveText('Installing…');
    await expect(blob(page)).toBeDisabled();
    await expect(blob(page)).toHaveClass(/installing/);

    await relaunchWith(page, {
      phase: 'off',
      offReason: 'dev',
      preview: false,
      availableVersion: null,
      progress: null,
      installRequested: false,
      previewUpdatedTo: '0.1.0-beta.2',
    });
    await expect(toasts(page)).toContainText('Updated to 0.1.0-beta.2 (preview)');
    await expect(blob(page)).toHaveAccessibleName('Updated to 0.1.0-beta.2 (preview)');
    await expect(blob(page)).toHaveClass(/updated/);
    await railShot(page, 'preview-toast');

    await blob(page).click();
    await expect(page.getByRole('dialog', { name: 'Updates' })).toBeVisible();
    await expect(blob(page)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(rail(page).getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(toasts(page)).toHaveCount(0);
    await expect(blob(page)).toHaveCount(0);
    expect(await desktopCalls(page)).toEqual([]);
  });

  test('the busy preview waits for running work before it installs', async ({ page }) => {
    await startPreview(page, 1);
    await downloadToReady(page);
    await blob(page).click();
    await expect(blob(page)).toHaveText('Waiting');
    await expect(toasts(page).filter({ hasText: 'when your work finishes' })).toBeVisible();
    await hoverTip(page, 'Spark will update when your work finishes.');

    await setRuns(page, 0);
    await blob(page).click();
    await expect(blob(page)).toHaveText('Installing…');
    expect(await desktopCalls(page)).toEqual([['install'], ['install'], ['install']]);
  });

  test('with reduced motion the fill steps in quarters and nothing hops', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startPreview(page);
    const animation = (selector: string) =>
      blob(page)
        .locator(selector)
        .first()
        .evaluate((node) => getComputedStyle(node).animationName);

    await blob(page).click();
    const steps: [number, string][] = [
      [9, '0'],
      [31, '25'],
      [64, '50'],
      [79, '75'],
      [97, '75'],
    ];
    for (const [percent, fill] of steps) {
      await pushUpdate(page, { progress: percent });
      await expect(blob(page)).toHaveText(`${percent}%`);
      await expect(blob(page)).toHaveAttribute('data-fill', fill);
    }
    expect(await animation('.sc-wave')).toBe('none');
    expect(await animation('.sc-hop')).toBe('none');
    const transition = await blob(page)
      .locator('.sc-fill-level')
      .evaluate((node) => getComputedStyle(node).transitionDuration);
    expect(transition).toBe('0s');

    await pushUpdate(page, { phase: 'ready', progress: 100, installRequested: false });
    await expect(blob(page)).toHaveText('Restart');
    expect(await animation('.sc-hop')).toBe('none');
    expect(await animation('.sc-body')).toBe('none');
  });

  test('the rail shows no version text and Settings, Updates shows it', async ({ page }) => {
    await resetTestDatabase({ onboarded: true });
    await fakeUpdater(page, {
      currentVersion: '0.1.0-beta.1',
      phase: 'off',
      offReason: 'dev',
      devBuild: true,
    });
    await page.goto('/');
    const settings = rail(page).getByRole('button', { name: 'Settings' });
    await expect(settings).toBeVisible();
    await expect(rail(page)).not.toContainText('0.1.0-beta.1');
    await expect(rail(page)).not.toContainText('dev');
    await expect(rail(page).getByRole('button', { name: /^App version/ })).toHaveCount(0);
    await expect(rail(page).getByRole('button').last()).toHaveAccessibleName('Settings');
    await railShot(page, 'rail-no-version');

    await settings.click();
    await page.getByRole('tab', { name: 'Updates' }).click();
    const updates = page.getByRole('dialog', { name: 'Updates' });
    await expect(updates.locator('.upd-version')).toHaveText('Spark Outpost 0.1.0-beta.1Beta');
    await expect(updates).toContainText('This dev copy never updates.');
  });

  test('a download shows its percentage on the update blob only', async ({ page }) => {
    await resetTestDatabase({ onboarded: true });
    await fakeUpdater(page, { currentVersion: '0.1.0-beta.1', autoDownload: false });
    await page.goto('/');
    await pushUpdate(page, { phase: 'available', availableVersion: '0.1.0-beta.2' });
    await blob(page).click();
    await pushUpdate(page, { progress: 42 });
    await expect(blob(page)).toHaveText('42%');
    await expect(blob(page)).toHaveAccessibleName('Getting Spark Outpost 0.1.0-beta.2: 42%');
    await expect(rail(page).getByText('42%')).toHaveCount(1);
  });
});
