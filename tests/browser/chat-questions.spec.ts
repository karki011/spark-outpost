import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { chatRepo, type ChatRepo, projectChat, resetWithAgents, send } from './project-chat-kit.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.CHAT_QUESTIONS_SHOTS ?? '';
const BOXED =
  '.head > *, .head-r > *, .ctxbar > *, .composer, .appr, .ai-head > *, .md pre, .cs-wrap';

const thread = (page: Page) => page.locator('.thread');
const waitingCard = (page: Page) => thread(page).getByRole('group', { name: /Change a file\?/ });
const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const workPanel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });
const rail = (page: Page) => page.getByRole('region', { name: 'Chat context' });
const statusLine = (page: Page) => page.locator('.cstatus .cs-wrap');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/chat-questions-${name}.png` });
}

async function spilled(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const main = document.querySelector('.main')!.getBoundingClientRect();
    return [...document.querySelectorAll(`.main :is(${selector})`)]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0) return false;
        return box.right > main.right + 1 || box.left < main.left - 1;
      })
      .map((element) => element.className.toString());
  }, BOXED);
}

async function pageScroll(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function setPanel(page: Page, open: boolean) {
  const isOpen = await page
    .locator('#work-panel')
    .evaluate((element) => element.classList.contains('on'));
  if (isOpen === open) return;
  if (open) {
    await page.locator('.head').getByRole('button', { name: 'Show work panel' }).click();
    await expect(workPanel(page)).toBeVisible();
    return;
  }
  await workPanel(page).getByRole('button', { name: 'Hide work panel' }).click();
  await expect(workPanel(page)).toBeHidden();
}

test.describe('a waiting card', () => {
  let repo: ChatRepo;

  test.beforeEach(async () => {
    await resetWithAgents();
    repo = chatRepo();
  });

  test.afterEach(() => repo.remove());

  test('the chat fits from a narrow window to a wide one, with and without the work panel', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await projectChat(page, repo, 'Ask before edits');
    await send(page, 'Fix the divider #build');
    await expect(waitingCard(page)).toBeVisible({ timeout: 30_000 });

    for (const width of [1728, 1440, 1024, 720]) {
      await page.setViewportSize({ width, height: 900 });
      for (const open of width > 1100 ? [true, false] : [false]) {
        await setPanel(page, open);
        await animationsSettled(page);
        await expect(waitingCard(page)).toBeInViewport();
        await expect(message(page)).toBeVisible();
        expect(await pageScroll(page), `page scroll at ${width}`).toBe(0);
        expect(await spilled(page), `spill at ${width}, panel ${open}`).toEqual([]);
        await expect
          .poll(async () => {
            const card = (await waitingCard(page).boundingBox())!;
            const scroller = (await thread(page).boundingBox())!;
            return card.x >= scroller.x && card.x + card.width <= scroller.x + scroller.width;
          })
          .toBe(true);
        await shot(page, `${width}-${open ? 'panel' : 'no-panel'}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(rail(page)).toBeVisible();
    await expect(rail(page).getByRole('region', { name: 'To-do' })).toHaveCount(0);
    await expect(thread(page).locator('.todo-card, .todo-line')).toHaveCount(0);
  });
});

test.describe('one status', () => {
  test.beforeEach(async () => {
    await resetTestDatabase({ onboarded: true });
  });

  test('a running turn shows its status once: in the turn header, or above the message box when the header is out of view', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await send(page, 'Keep going until I stop you #slowbuild');
    const turnHead = thread(page).locator('.ai-head').last();
    await expect(turnHead.locator('.mood')).toHaveText('working');
    await expect(statusLine(page)).toHaveCount(0);
    await expect(thread(page).locator('.dots')).toHaveCount(0);
    await expect(page.locator('.cstatus').getByRole('status')).toHaveText(/is thinking/);
    await expect(thread(page).getByRole('status')).toHaveCount(0);
    await shot(page, 'status-after');

    await page.addStyleTag({ content: '.thread .col { padding-bottom: 200vh; }' });
    await page.locator('.thread').evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect(turnHead).not.toBeInViewport();
    await expect(statusLine(page)).toHaveText(/is thinking…$/);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(turnHead.locator('.mood')).toHaveText('stopped');
  });

  test('a finished to-do lists in the rail on a roomy window, and keeps one line in the thread', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await send(page, 'Fix the date divider #plan');
    await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 20_000 });
    const todo = rail(page).getByRole('region', { name: 'To-do' });
    await expect(todo.getByRole('listitem')).toHaveCount(3);
    await expect(todo).toContainText('3 of 3');
    await expect(todo.getByRole('listitem').first()).toContainText('Done:');
    const line = thread(page).getByRole('button', { name: 'To-do: 3 of 3 done' });
    await expect(line).toBeVisible();
    await shot(page, 'status-tasks-rail');

    await rail(page).getByRole('button', { name: 'Hide context rail' }).click();
    await expect(line).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(line).toBeVisible();
  });
});
