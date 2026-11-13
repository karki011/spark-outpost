import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addSpark,
  fakeCrewFiles,
  openSparksPage,
  SKILL_TEXT,
  type FakeCrewFiles,
} from './crew-files-kit.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';

const SHOTS = 'test-results/sparks-page';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

let files: FakeCrewFiles;

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, catalog: true });
  files = await fakeCrewFiles(page);
});

const pageMain = (page: Page) => page.locator('main.sparks');
const tree = (page: Page) => page.getByRole('tree');
const editor = (page: Page) => page.getByRole('textbox', { name: /^Contents of / });

async function shots(page: Page, name: string) {
  await page.mouse.move(0, 0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await animationsSettled(page);
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function passesAxe(page: Page) {
  await animationsSettled(page);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('main.sparks')
    .analyze();
  expect(scan.violations).toEqual([]);
}

async function openSpark(page: Page, name: string) {
  await pageMain(page)
    .getByRole('button', { name: new RegExp(`^Open ${name}\\.`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function openFiles(page: Page) {
  await page.getByRole('tab', { name: /^Skills and files/ }).click();
  await expect(tree(page)).toBeVisible();
}

async function tallEnough(locator: Locator, min: number) {
  const box = await locator.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(min);
}

test('an empty crew offers starters, counts its tabs and holds a place for workflows', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSparksPage(page);
  const main = pageMain(page);
  await expect(main.getByRole('heading', { name: 'Build your crew' })).toBeVisible();
  await expect(main.getByRole('tab', { name: 'Crew 0' })).toHaveAttribute('aria-selected', 'true');
  const starters = main.getByRole('list', { name: 'Suggested Sparks' });
  await expect(starters.getByRole('listitem')).toHaveCount(3);
  await passesAxe(page);
  await shots(page, 'crew-empty');

  await main.getByRole('tab', { name: /^Workflows/ }).click();
  await expect(main.getByRole('heading', { name: 'Workflows' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'New Spark' })).toHaveCount(0);
  await main.getByRole('tab', { name: /^Crew/ }).click();

  await starters.getByRole('button', { name: 'Add Pip, Code reviewer' }).click();
  await expect(main.getByRole('tab', { name: 'Crew 1' })).toBeVisible();
  const card = main.getByRole('button', { name: /^Open Pip\. Code reviewer\./ });
  await expect(card).toContainText('No skills');
});

test('New Spark creates one and opens it; its card shows agent, mode and skills', async ({
  page,
}) => {
  await openSparksPage(page);
  await pageMain(page).getByRole('button', { name: 'New Spark' }).click();
  const sheet = page.getByRole('dialog', { name: 'New Spark' });
  await sheet.getByLabel('Name').fill('Security');
  await sheet.getByLabel('Role').fill('Finds vulnerabilities');
  await shots(page, 'new-spark');
  await sheet.getByRole('button', { name: 'Create Spark' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  const details = page.getByRole('tabpanel', { name: 'Details' });
  await expect(sheet).toHaveCount(0);
  await expect(details.getByLabel('Name')).toHaveValue('Security');
  await passesAxe(page);
  await shots(page, 'spark-details');

  await details.getByLabel('Role').fill('Finds security holes');
  await details.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(pageMain(page).getByRole('status')).toContainText('Saved');

  const list = (await (await page.request.get('/api/teammates')).json()) as {
    teammates: { id: string; role: string }[];
  };
  expect(list.teammates[0]?.role).toBe('Finds security holes');
  files.put(list.teammates[0]!.id, 'skills/dependency-audit/SKILL.md', SKILL_TEXT);

  await page.getByRole('button', { name: 'All Sparks' }).click();
  const card = pageMain(page).getByRole('button', { name: /^Open Security\./ });
  await expect(card).toContainText('Finds security holes');
  await expect(card).toContainText('Default agent · Default mode');
  await expect(card).toContainText('No skills');
  await addSpark(page, { name: 'Lint', role: 'Style and lint rules' });
  await addSpark(page, { name: 'Types', role: 'Type errors' });
  await page.reload();
  await expect(card).toContainText('1 skill');
  await expect(pageMain(page).getByRole('tab', { name: 'Crew 3' })).toBeVisible();
  await passesAxe(page);
  await shots(page, 'crew-filled');
});

test('add a skill and a script, edit, save, rename and delete', async ({ page }) => {
  const id = await addSpark(page, { name: 'Security', role: 'Finds vulnerabilities' });
  await openSparksPage(page);
  await openSpark(page, 'Security');
  await page.getByRole('button', { name: 'Edit instructions' }).click();
  await expect(tree(page).getByRole('treeitem', { name: 'SPARK.md' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await editor(page).fill('Review the diff for injection and secret handling problems.');
  await expect(tree(page).getByRole('treeitem', { name: /SPARK\.md/ })).toContainText('Edited');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.spk-editor-h').getByRole('status')).toContainText('Saved');
  expect(files.text(id, 'SPARK.md')).toContain('injection');
  expect(files.saves.at(-1)).toEqual({ sparkId: id, path: 'SPARK.md', baseHash: null });

  await page.getByRole('button', { name: 'New skill' }).click();
  const skill = page.getByRole('form', { name: 'New skill' });
  await skill.getByLabel('Name').fill('Dependency Audit');
  await skill.getByRole('button', { name: 'Create skill' }).click();
  await expect(skill.getByRole('alert').first()).toContainText('lower-case letters');
  await expect(skill.getByRole('alert').last()).toContainText('Say in a sentence');
  await shots(page, 'new-skill-problems');
  await skill.getByLabel('Name').fill('dependency-audit');
  await skill
    .getByLabel('Description')
    .fill('Check changed dependencies for known vulnerabilities.');
  await skill.getByRole('button', { name: 'Create skill' }).click();
  await expect(
    page.getByRole('heading', { name: 'skills/dependency-audit/SKILL.md' }),
  ).toBeVisible();
  await expect(editor(page)).toHaveValue(
    /^---\nname: dependency-audit\ndescription: Check changed/,
  );
  await expect(page.getByRole('tab', { name: 'Skills and files 2' })).toBeVisible();

  await page.getByRole('button', { name: 'New file' }).click();
  const file = page.getByRole('form', { name: 'New file' });
  await expect(file.getByLabel('Path')).toHaveValue('skills/dependency-audit/');
  await file.getByLabel('Path').fill('skills/dependency-audit/../audit.sh');
  await file.getByRole('button', { name: 'Create file' }).click();
  await expect(file.getByRole('alert')).toContainText('Folder and file names use letters');
  await file.getByLabel('Path').fill('skills/dependency-audit/scripts/audit.sh');
  await file.getByRole('button', { name: 'Create file' }).click();
  await expect(
    page.getByRole('heading', { name: 'skills/dependency-audit/scripts/audit.sh' }),
  ).toBeVisible();
  await editor(page).fill('#!/bin/sh\nnpm audit --json\n');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.spk-editor-h').getByRole('status')).toContainText('Saved');
  expect(files.text(id, 'skills/dependency-audit/scripts/audit.sh')).toContain('npm audit');
  await passesAxe(page);
  await shots(page, 'skills-and-files');

  await tree(page).getByRole('treeitem', { name: 'SKILL.md' }).click();
  await editor(page).fill('No block here.');
  await expect(page.locator('.spk-editor-f')).toContainText(
    'starts with a block between --- lines',
  );
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await shots(page, 'skill-file-problem');
  await editor(page).fill(SKILL_TEXT);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.spk-editor-h').getByRole('status')).toContainText('Saved');

  await tree(page).getByRole('treeitem', { name: 'audit.sh' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('New path').fill('skills/dependency-audit/SKILL.md');
  await expect(page.locator('.spk-inline').getByRole('alert')).toContainText('already exists');
  await page.getByLabel('New path').fill('skills/dependency-audit/scripts/check.sh');
  await page.locator('.spk-inline').getByRole('button', { name: 'Rename' }).click();
  await expect(
    page.getByRole('heading', { name: 'skills/dependency-audit/scripts/check.sh' }),
  ).toBeVisible();
  await expect(editor(page)).toHaveValue('#!/bin/sh\nnpm audit --json\n');
  expect(files.paths(id)).toEqual([
    'SPARK.md',
    'skills/dependency-audit/SKILL.md',
    'skills/dependency-audit/scripts/check.sh',
  ]);

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: /^Delete skills/ });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Delete file' }).click();
  await expect(tree(page).getByRole('treeitem', { name: 'check.sh' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'SPARK.md' })).toBeVisible();
  expect(files.paths(id)).toEqual(['SPARK.md', 'skills/dependency-audit/SKILL.md']);
});

test('a save conflict says the file changed and offers Reload or saving over it', async ({
  page,
}) => {
  const id = await addSpark(page, { name: 'Security', role: 'Finds vulnerabilities' });
  files.put(id, 'SPARK.md', 'First version.');
  await openSparksPage(page);
  await openSpark(page, 'Security');
  await openFiles(page);
  await expect(editor(page)).toHaveValue('First version.');
  await editor(page).fill('My version.');
  files.put(id, 'SPARK.md', 'Changed by an agent.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const conflict = page.locator('.spk-conflict');
  await expect(conflict).toContainText('This file changed since you opened it.');
  expect(files.text(id, 'SPARK.md')).toBe('Changed by an agent.');
  await passesAxe(page);
  await shots(page, 'save-conflict');

  await conflict.getByRole('button', { name: 'Reload' }).click();
  await expect(editor(page)).toHaveValue('Changed by an agent.');
  await expect(conflict).toHaveCount(0);

  await editor(page).fill('My version again.');
  files.put(id, 'SPARK.md', 'Changed once more.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await conflict.getByRole('button', { name: 'Save mine over it' }).click();
  await expect(conflict).toHaveCount(0);
  await expect(page.locator('.spk-editor-h').getByRole('status')).toContainText('Saved');
  expect(files.text(id, 'SPARK.md')).toBe('My version again.');
});

test('unsaved edits survive opening another file and leaving the page', async ({ page }) => {
  const id = await addSpark(page, { name: 'Security', role: 'Finds vulnerabilities' });
  files.put(id, 'SPARK.md', 'Instructions.');
  files.put(id, 'notes.txt', 'Notes.');
  await openSparksPage(page);
  await openSpark(page, 'Security');
  await openFiles(page);
  await editor(page).fill('Instructions, edited.');
  await tree(page).getByRole('treeitem', { name: 'notes.txt' }).click();
  await expect(editor(page)).toHaveValue('Notes.');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Sparks/ })
    .click();
  await openSpark(page, 'Security');
  await openFiles(page);
  await expect(editor(page)).toHaveValue('Instructions, edited.');
  await expect(page.locator('.spk-editor-h').getByRole('status')).toContainText('Edited');
});

test('the page works with the keyboard alone', async ({ page }) => {
  const id = await addSpark(page, { name: 'Security', role: 'Finds vulnerabilities' });
  files.put(id, 'SPARK.md', 'Instructions.');
  files.put(id, 'skills/dependency-audit/SKILL.md', SKILL_TEXT);
  files.put(id, 'skills/dependency-audit/scripts/audit.sh', 'npm audit\n');
  await page.goto('/');
  const rail = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Sparks/ });
  await rail.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Sparks' })).toBeVisible();

  await page.getByRole('tab', { name: /^Crew/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /^Workflows/ })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Tab');
  await expect(pageMain(page).getByRole('button', { name: /^Open Security\./ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();

  await page.getByRole('tab', { name: 'Details' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tree(page)).toBeVisible();
  await page.keyboard.press('Tab');
  const row = (name: string) => tree(page).getByRole('treeitem', { name });
  await expect(row('SPARK.md')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row('skills')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(row('skills')).toHaveAttribute('aria-expanded', 'false');
  await expect(row('dependency-audit')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(row('dependency-audit')).toBeFocused();
  await page.keyboard.press('End');
  await expect(row('audit.sh')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row('audit.sh')).toHaveAttribute('aria-selected', 'true');
  await expect(editor(page)).toHaveValue('npm audit\n');

  await editor(page).focus();
  await page.keyboard.type('set -e ');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.spk-editor-h').getByRole('status')).toContainText('Saved');
  expect(files.text(id, 'skills/dependency-audit/scripts/audit.sh')).toContain('set -e ');

  await page.getByRole('button', { name: 'New skill' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('form', { name: 'New skill' }).getByLabel('Name')).toBeFocused();
  await page.keyboard.type('secret-scan');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Look for committed secrets.');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'skills/secret-scan/SKILL.md' })).toBeVisible();
  expect(files.text(id, 'skills/secret-scan/SKILL.md')).toContain('name: secret-scan');

  for (const control of [
    page.getByRole('button', { name: 'New skill' }),
    page.getByRole('button', { name: 'Save', exact: true }),
    row('SPARK.md'),
    page.getByRole('tab', { name: 'Details' }),
  ]) {
    await tallEnough(control, 28);
  }
});

test('Settings has no Sparks section; Home’s Manage opens the page', async ({ page }) => {
  await addSpark(page, { name: 'Pip', role: 'Code reviewer' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Profile & personality' });
  await expect(settings.getByRole('tab', { name: 'Models' })).toBeVisible();
  await expect(settings.getByRole('tab', { name: 'Crew' })).toHaveCount(0);
  await expect(settings.getByRole('tab', { name: 'Sparks' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  const roster = page.locator('.hsparks');
  if ((await roster.getAttribute('open')) === null) await roster.locator('summary').click();
  await roster.getByRole('button', { name: 'Manage' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sparks' })).toBeVisible();
  await expect(pageMain(page).getByRole('button', { name: /^Open Pip\./ })).toBeVisible();
});

test('a phone reads the page; a paired device sees identity and that files stay on the Mac', async ({
  page,
}) => {
  const id = await addSpark(page, { name: 'Security', role: 'Finds vulnerabilities' });
  files.put(id, 'SPARK.md', 'Instructions.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'More' })
    .click();
  await page
    .getByRole('group', { name: 'More destinations' })
    .getByRole('button', { name: 'Sparks' })
    .click();
  await openSpark(page, 'Security');
  await openFiles(page);
  await expect(editor(page)).toHaveValue('Instructions.');
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);
  await shots(page, 'phone-files');

  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...((await response.json()) as object),
        remote: true,
        device: { id: '00000000-0000-4000-8000-000000000001', name: 'Maya’s iPhone' },
        address: 'https://mac.tail.test',
      },
    });
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'More' })
    .click();
  await page
    .getByRole('group', { name: 'More destinations' })
    .getByRole('button', { name: 'Sparks' })
    .click();
  await expect(pageMain(page).getByRole('button', { name: 'New Spark' })).toHaveCount(0);
  await openSpark(page, 'Security');
  await expect(pageMain(page)).toContainText('Finds vulnerabilities');
  await expect(pageMain(page)).toContainText(
    'Edit this Spark, its instructions, skills and files on the Mac.',
  );
  await expect(page.getByRole('tab')).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await passesAxe(page);
  await shots(page, 'phone-paired');
});
