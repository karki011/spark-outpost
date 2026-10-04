import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SHOTS = process.env.SPARK_SHEET_SHOTS ?? 'test-results/spark-sheet';

let base = '';
let roles = '';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-sheet-')));
  roles = path.join(base, 'roles');
  mkdirSync(path.join(roles, 'archive'), { recursive: true });
  mkdirSync(path.join(roles, '.agents'));
  mkdirSync(path.join(base, 'webapp'));
  writeFileSync(path.join(roles, 'reviewer.md'), '# Reviewer\nName the file and line.\n');
  writeFileSync(path.join(roles, 'long.txt'), 'word '.repeat(600));
  writeFileSync(path.join(roles, 'data.json'), '{}');
  writeFileSync(path.join(roles, '.env'), 'TOKEN=abc');
  writeFileSync(path.join(roles, 'credentials.md'), 'secret');
  writeFileSync(path.join(roles, '.agents', 'release.md'), 'Check the changelog.');
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

const sheet = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });

interface StoredSpark {
  name: string;
  faceAuto: boolean;
  face: { shape: string; color: string };
  instructionsPath: string | null;
  projectIds: string[];
}

async function storedSparks(page: Page): Promise<StoredSpark[]> {
  const body = (await (await page.request.get('/api/teammates')).json()) as {
    teammates: StoredSpark[];
  };
  return body.teammates;
}

async function openNewSpark(page: Page): Promise<Locator> {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await page
    .getByRole('region', { name: 'Your Sparks' })
    .getByRole('button', { name: 'New Spark' })
    .click();
  const form = sheet(page, 'New Spark');
  await expect(form).toBeVisible();
  return form;
}

async function browseTo(dialog: Locator, target: string) {
  await dialog.getByRole('navigation', { name: 'Folder path' }).getByRole('button').first().click();
  await expect(dialog.getByRole('button', { name: 'Parent folder' })).toBeDisabled();
  for (const segment of target.split('/').filter(Boolean)) {
    await dialog
      .getByRole('list', { name: 'Folders' })
      .getByRole('button', { name: segment, exact: true })
      .click();
    await expect(
      dialog.getByRole('navigation', { name: 'Folder path' }).locator('[aria-current="location"]'),
    ).toHaveText(segment);
  }
}

const previewMarkup = (form: Locator) =>
  form.locator('.tm-preview').evaluate((node) => node.innerHTML);

test('a new Spark gets its blob from its name, with the pickers one click away', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const form = await openNewSpark(page);
  const name = form.getByRole('textbox', { name: 'Name' });
  await expect(form.getByRole('radiogroup')).toHaveCount(0);
  await expect(form).toContainText('Its blob comes from its name.');

  await name.fill('Juniper');
  const juniper = await previewMarkup(form);
  await name.fill('Maple');
  await expect.poll(() => previewMarkup(form)).not.toBe(juniper);
  await name.fill('Juniper');
  await expect.poll(() => previewMarkup(form)).toBe(juniper);

  const original = await page.evaluate(() => document.documentElement.dataset.skin ?? null);
  for (const [skin, shot] of [
    ['light', 'light'],
    ['graphite', 'dark'],
  ] as const) {
    await page.evaluate((next) => {
      document.documentElement.dataset.skin = next;
    }, skin);
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .include('.tm-sheet')
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/spark-sheet-${shot}.png` });
  }
  await page.evaluate((skin) => {
    if (skin) document.documentElement.dataset.skin = skin;
    else delete document.documentElement.dataset.skin;
  }, original);

  const change = form.getByRole('button', { name: 'Change look' });
  await expect(change).toHaveAttribute('aria-expanded', 'false');
  await name.press('Tab');
  await expect(form.getByRole('textbox', { name: 'Role' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(change).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(change).toHaveAttribute('aria-expanded', 'true');
  await form.getByRole('radio', { name: 'Sun' }).click();
  await expect(form).toContainText('You picked this blob.');
  await page.screenshot({ path: `${SHOTS}/spark-sheet-change-look.png` });
  await form.getByRole('button', { name: 'Use name' }).click();
  await expect(form).toContainText('Its blob comes from its name.');
  await expect.poll(() => previewMarkup(form)).toBe(juniper);

  await form.getByRole('button', { name: 'Create Spark' }).click();
  await expect(form).toHaveCount(0);
  const [saved] = await storedSparks(page);
  expect(saved).toMatchObject({ name: 'Juniper', faceAuto: true });
  const rosterFace = await page
    .getByRole('region', { name: 'Your Sparks' })
    .locator('.tm-card .tm-face')
    .first()
    .evaluate((node) => node.querySelector('path')?.getAttribute('d') ?? '');
  expect(rosterFace.length).toBeGreaterThan(0);
});

test('a picked look survives editing and Use name puts the blob back on the name', async ({
  page,
}) => {
  await page.request.post('/api/teammates', {
    data: { name: 'Pip', face: { shape: 'sun', color: 'gold' } },
  });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await page.getByRole('button', { name: 'Edit Pip' }).click();
  const form = sheet(page, 'Edit Pip');
  await expect(form).toContainText('You picked this blob.');
  await form.getByRole('textbox', { name: 'Role' }).fill('Reviewer');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  expect((await storedSparks(page))[0]).toMatchObject({
    faceAuto: false,
    face: { shape: 'sun', color: 'gold' },
  });

  await page.getByRole('button', { name: 'Edit Pip' }).click();
  await form.getByRole('button', { name: 'Use name' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  expect((await storedSparks(page))[0]).toMatchObject({ faceAuto: true });
});

test('points standing instructions at a file with the themed picker @packaged', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const form = await openNewSpark(page);
  await form.getByRole('textbox', { name: 'Name' }).fill('Pip');
  const useFile = form.getByRole('button', { name: 'Use a file…' });
  await useFile.focus();
  await page.keyboard.press('Enter');

  const picker = page.getByRole('dialog', { name: 'Choose an instructions file' });
  await expect(picker).toBeVisible();
  const use = picker.getByRole('button', { name: 'Use this file' });
  await expect(use).toBeDisabled();
  await page.keyboard.press('Shift+Tab');
  await expect(picker.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(picker.getByRole('button', { name: 'Close' })).toBeFocused();
  await browseTo(picker, roles);

  const files = picker.getByRole('list', { name: 'Files' });
  await expect(files.getByRole('button')).toHaveText([/long\.txt/, /reviewer\.md/]);
  await expect(picker).not.toContainText('.env');
  await expect(picker).not.toContainText('credentials.md');
  await expect(picker).not.toContainText('data.json');
  await expect(picker.getByRole('button', { name: '.agents' })).toHaveCount(0);

  await picker.getByRole('switch', { name: 'Show hidden folders and files' }).click();
  await expect(picker.getByRole('button', { name: '.agents' })).toBeVisible();
  await expect(picker).not.toContainText('.env');

  await files.getByRole('button', { name: /reviewer\.md/ }).click();
  await expect(files.getByRole('button', { name: /reviewer\.md/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(picker.locator('.fdlg-path')).toHaveText(path.join(roles, 'reviewer.md'));
  await page.screenshot({ path: `${SHOTS}/spark-sheet-file-picker.png` });
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.fdlg')
    .analyze();
  expect(scan.violations).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(useFile).toBeFocused();

  await useFile.click();
  await browseTo(picker, roles);
  await files.getByRole('button', { name: /long\.txt/ }).click();
  await use.click();
  await expect(picker).toHaveCount(0);
  const card = form.getByRole('group', { name: 'Instructions file' });
  await expect(card).toContainText('long.txt');
  await expect(card).toContainText('3 KB');
  await expect(card).toContainText('Cut at 2,000 characters');
  await expect(form).toContainText('used instead of this text');

  await form.getByRole('button', { name: 'Change file…' }).click();
  await expect(picker.locator('.fdlg-path')).toHaveText(roles);
  await files.getByRole('button', { name: /reviewer\.md/ }).dblclick();
  await expect(card.getByLabel('File preview')).toContainText('Name the file and line.');
  await form.getByRole('textbox', { name: 'Standing instructions' }).fill('Typed fallback.');
  await page.screenshot({ path: `${SHOTS}/spark-sheet-instructions-file.png` });
  const sheetScan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.tm-sheet')
    .analyze();
  expect(sheetScan.violations).toEqual([]);

  await form.getByRole('button', { name: 'Create Spark' }).click();
  await expect(form).toHaveCount(0);
  expect((await storedSparks(page))[0]).toMatchObject({
    instructionsPath: path.join(roles, 'reviewer.md'),
  });

  rmSync(path.join(roles, 'reviewer.md'));
  await page.getByRole('button', { name: 'Edit Pip' }).click();
  const editing = sheet(page, 'Edit Pip');
  await expect(editing.getByRole('group', { name: 'Instructions file' })).toContainText(
    'This file is missing. Chats use the typed instructions below',
  );
  await editing.getByRole('button', { name: 'Remove instructions file' }).click();
  await expect(editing.getByRole('group', { name: 'Instructions file' })).toHaveCount(0);
  await editing.getByRole('button', { name: 'Save' }).click();
  await expect(editing).toHaveCount(0);
  expect((await storedSparks(page))[0]).toMatchObject({ instructionsPath: null });
  writeFileSync(path.join(roles, 'reviewer.md'), '# Reviewer\nName the file and line.\n');
});

test('picks any folder as the default project from the sheet', async ({ page }) => {
  const form = await openNewSpark(page);
  await form.getByRole('textbox', { name: 'Name' }).fill('Bolt');
  await form.getByRole('button', { name: 'Choose folder…' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a project folder' });
  await browseTo(picker, path.join(base, 'webapp'));
  await picker.getByRole('button', { name: 'Use this folder' }).click();
  await expect(picker).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Default project' })).toContainText('webapp');
  await expect(form.getByRole('button', { name: 'Choose folder…' })).toBeFocused();

  await form.getByRole('button', { name: 'Create Spark' }).click();
  await expect(form).toHaveCount(0);
  const projects = (await (await page.request.get('/api/projects')).json()) as {
    id: string;
    rootPath: string;
  }[];
  const webapp = projects.find((project) => project.rootPath === path.join(base, 'webapp'));
  expect((await storedSparks(page))[0]?.projectIds).toEqual([webapp?.id]);
});
