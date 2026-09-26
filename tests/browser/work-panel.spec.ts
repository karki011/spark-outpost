import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  CREW_REQUEST,
  agentBlock,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';

const SHOTS = process.env.FILES_SHOTS ?? '';

const panel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const skin of ['graphite', 'apricot']) {
    await page.evaluate((value) => (document.documentElement.dataset.skin = value), skin);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `files-${name}-${skin}.png`) });
  }
}

async function panelWidth(page: Page): Promise<number> {
  return Math.round((await panel(page).boundingBox())?.width ?? 0);
}

test('the work panel is wider by default, resizes from its edge and remembers the width', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.taskc')).toContainText('Task · 7 of 7 done', { timeout: 20_000 });
  await expect.poll(() => panelWidth(page)).toBe(432);

  const handle = page.getByRole('separator', { name: 'Resize work panel' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 97, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => panelWidth(page)).toBe(532);
  await expect(handle).toHaveAttribute('aria-valuenow', '532');

  await page.reload();
  await expect.poll(() => panelWidth(page)).toBe(532);

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => panelWidth(page)).toBe(516);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => panelWidth(page)).toBe(548);
  await page.keyboard.press('Home');
  await expect.poll(() => panelWidth(page)).toBe(340);
  await page.keyboard.press('End');
  await expect.poll(() => panelWidth(page)).toBe(640);
  await handle.dblclick();
  await expect.poll(() => panelWidth(page)).toBe(432);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(handle).toHaveCount(0);
});

test('the work panel slides open and closed without moving the thread', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1600, height: 420 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.taskc')).toContainText('Task · 7 of 7 done', { timeout: 20_000 });
  await expect.poll(() => panelWidth(page)).toBe(432);

  const thread = page.locator('.thread');
  const range = await thread.evaluate((element) => element.scrollHeight - element.clientHeight);
  expect(range).toBeGreaterThan(120);
  const middle = 24;
  await thread.evaluate((element, top) => (element.scrollTop = top), middle);
  const scrollTop = () => thread.evaluate((element) => element.scrollTop);
  const header = page.getByRole('main').locator('.head');
  const title = await header.locator('.chat-title').boundingBox();

  const aside = page.locator('#work-panel');
  const asideWidth = async () => Math.round((await aside.boundingBox())?.width ?? -1);
  await header.getByRole('button', { name: 'Hide work panel' }).click();
  await expect.poll(asideWidth).toBe(0);
  await expect(panel(page)).toBeHidden();
  expect(await scrollTop()).toBe(middle);
  expect(await header.locator('.chat-title').boundingBox()).toEqual(title);

  await header.getByRole('button', { name: 'Show work panel' }).click();
  await expect.poll(() => panelWidth(page)).toBe(432);
  expect(await scrollTop()).toBe(middle);
});

test.describe('a finished crew', () => {
  let repo: CrewRepo;

  test.beforeEach(async ({ page }) => {
    await resetCrew();
    repo = crewRepo();
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  test.afterEach(() => repo.remove());

  test('Cost groups by agent and the crew turn lists its changed files', async ({ page }) => {
    test.setTimeout(90_000);
    await crewChat(page, repo, 'Full auto');
    await send(page, `${CREW_REQUEST} #build #crew`);
    await expect(page.locator('.crew-turn .crew-foot')).toContainText(/Done 3 agents/, {
      timeout: 30_000,
    });

    const files = page.locator('.crew-turn > .fchg');
    await expect(files).toContainText('1 file changed+3 −0');
    await files.getByRole('button', { name: 'Open notes.txt' }).click();
    await expect(files.locator('.dv-row.add').first()).toContainText('step 1');
    await expect(agentBlock(page, 'Bolt').locator('.fchg')).toHaveCount(0);

    const work = panel(page);
    await work.getByRole('tab', { name: 'Cost' }).click();
    const rows = work.getByRole('list', { name: 'Cost by agent' }).getByRole('listitem');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('SketchArchitect · Opus 5.5high');
    await expect(rows.nth(1)).toContainText('BoltBuilder · Sonnet 5');
    await expect(rows.last()).toContainText('JevDispatcherestimated');
    await expect(work.getByText('opus[1m]')).toHaveCount(0);
    for (const row of await rows.all()) {
      const height = (await row.boundingBox())!.height;
      expect(height).toBeLessThan(40);
    }
    await expect(work.getByRole('list', { name: 'Cost by model' })).toContainText('6 Sol');
    await expect(work.getByRole('img', { name: /^Cost by model: / })).toBeVisible();
    await shot(page, 'cost');

    await work.getByRole('button', { name: 'View in audit' }).click();
    await expect(page.getByRole('dialog', { name: /Audit/ })).toBeVisible();
  });
});
