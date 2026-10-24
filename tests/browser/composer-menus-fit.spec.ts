import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { editedChat } from './edited-chat.ts';
import { FITS, menuFit } from './menu-fit-kit.ts';
import { openChats } from './navigation.ts';
import { chatRepo, type ChatRepo } from './project-chat-kit.ts';
import { openTouch, PHONE, shot, smallTapTargets } from './responsive-kit.ts';
import { seedChats } from './sidebar-seed.ts';

const PROJECTS = [
  'feature-ai-telemetry-pipeline',
  'feature-web-apps',
  'feature-ai-control-plane',
  'feature-data-access-controls',
];
const LONG_TITLE = 'CP-49259 Wire the telemetry ingest endpoints into the grant checks';
const MAC = { width: 1280, height: 800 };
const NARROW_MAC = { width: 760, height: 700 };

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-menu-fit-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

async function seed(page: Page): Promise<void> {
  const ids: string[] = [];
  for (const name of PROJECTS) {
    const folder = path.join(base, name);
    mkdirSync(folder, { recursive: true });
    const response = await page.request.post('/api/projects', { data: { rootPath: folder } });
    expect(response.ok()).toBe(true);
    ids.push(((await response.json()) as { id: string }).id);
  }
  await seedChats([
    { title: LONG_TITLE, projectIds: [ids[0]!], run: { status: 'running' } },
    { title: 'CP-49301 Grant questions for ingest', projectIds: ids, run: { status: 'succeeded' } },
    { title: '', projectIds: [ids[3]!, ids[1]!], run: { status: 'succeeded' } },
    { title: 'Short', projectIds: [ids[3]!], run: { status: 'failed', error: 'boom' } },
  ]);
}

async function openPicker(page: Page) {
  await page.getByRole('button', { name: 'New chat', exact: true }).first().dispatchEvent('click');
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await page.getByRole('button', { name: 'Add files and context' }).click();
  await page.getByRole('menuitem', { name: 'Add another chat…' }).click();
  const picker = page.getByRole('dialog', { name: 'Add another chat' });
  await expect(picker).toHaveCSS('opacity', '1');
  await expect(picker.getByRole('option')).toHaveCount(4);
  return picker;
}

async function checkPicker(page: Page, touch: boolean): Promise<void> {
  const picker = await openPicker(page);
  expect(
    await menuFit(picker, '.chatopt', ['svg', '.fname b', '.chat-proj', '.chat-state']),
  ).toEqual(FITS);

  const untitled = picker.getByRole('option', { name: /^New chat, / });
  await expect(untitled).toHaveAccessibleName(
    'New chat, feature-data-access-controls, feature-web-apps, Done',
  );
  await expect(untitled.locator('.chat-proj')).toHaveText('feature-data-access-controls+1');

  const many = picker.getByRole('option', { name: /^CP-49301/ });
  await expect(many.locator('.chat-proj-more')).toHaveText('+3');
  const long = picker.getByRole('option', { name: new RegExp(`^${LONG_TITLE}`) });
  const titleWidth = (await long.locator('b').boundingBox())!.width;
  const projectWidth = (await long.locator('.chat-proj').boundingBox())!.width;
  expect(titleWidth).toBeGreaterThan(projectWidth);
  await expect(long).toHaveAttribute('title', new RegExp(`^${LONG_TITLE}\n`));

  if (touch) expect(await smallTapTargets(page, '.chatopt')).toEqual([]);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await shot(page, `chat-picker-${theme}`);
  }
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

for (const size of [MAC, NARROW_MAC]) {
  test(`the add-a-chat picker keeps titles, projects and states apart at ${size.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openChats(page);
    await seed(page);
    await page.reload();
    await checkPicker(page, false);
  });
}

test('the add-a-chat picker fits a 390px phone with touch-sized rows', async ({ browser }) => {
  const page = await openTouch(browser, PHONE, 'chats');
  await seed(page);
  await page.reload();
  await checkPicker(page, true);
  await page.close();
});

const ROWS = '.fopt, .mopt';

async function openChip(page: Page, selector: string): Promise<void> {
  const details = page.locator('.ctxbar').getByRole('button', { name: 'Chat details' });
  if (await details.isVisible()) {
    if ((await details.getAttribute('aria-expanded')) !== 'true') await details.click();
    await page.locator(`.ctx-more ${selector}`).click();
  } else {
    await page.locator(`.ctxbar ${selector}`).first().click();
  }
}

async function checkMenu(page: Page, name: string, menu: ReturnType<Page['locator']>) {
  await expect(menu).toHaveCSS('opacity', '1');
  expect(await menuFit(menu, ROWS), name).toEqual(FITS);
  await shot(page, `menu-${name}`);
}

async function checkMenus(page: Page): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill('/');
  await checkMenu(page, 'slash', page.locator('.slashpop'));
  await input.fill('@');
  await expect(page.locator('.mentionpop .fopt').first()).toBeVisible();
  await checkMenu(page, 'mention', page.locator('.mentionpop'));
  await input.fill('');

  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await checkMenu(
    page,
    'model',
    page.getByRole('dialog', { name: 'Model, effort, and permissions' }),
  );
  await page.keyboard.press('Escape');

  await openChip(page, '.chat-branch');
  await checkMenu(page, 'branch', page.getByRole('dialog', { name: 'This chat’s branch' }));
  await page.keyboard.press('Escape');

  await openChip(page, '.ctx-repo');
  await checkMenu(page, 'repos', page.getByRole('dialog', { name: 'Project folders' }));
  await page.keyboard.press('Escape');
}

test.describe('composer menus in a project chat', () => {
  let repo: ChatRepo;

  test.beforeEach(async ({ page }) => {
    repo = chatRepo();
    repo.commit('grant-checks-for-the-iceberg-ingest-tables-and-telemetry.ts', 'x\n');
    await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
    await page.setViewportSize(MAC);
    await editedChat(page, repo.root);
  });

  test.afterEach(() => repo.remove());

  for (const size of [MAC, NARROW_MAC]) {
    test(`fit the composer at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.reload();
      await checkMenus(page);
    });
  }

  for (const width of [PHONE.width, 320]) {
    test(`fit the composer on a ${width}px phone`, async ({ browser }) => {
      const page = await openTouch(browser, { ...PHONE, width }, 'chats');
      await checkMenus(page);
      await page.close();
    });
  }
});
