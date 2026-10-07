import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  agentBlock,
  autoContinueAfter,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.CHAT_QUESTIONS_SHOTS ?? '';
const THREE = 'Tell me anything about this repo #build #vague #questions #three';
const QUESTIONS = /Spark has a few questions/;
const BOXED =
  '.head > *, .head-r > *, .ctxbar > *, .composer, .appr, .ai-head > *, .md pre, .cs-wrap';

const thread = (page: Page) => page.locator('.thread');
const questions = (page: Page) => thread(page).getByRole('group', { name: QUESTIONS });
const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const workPanel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });
const rail = (page: Page) => page.getByRole('region', { name: 'Chat context' });
const statusLine = (page: Page) => page.locator('.cstatus .cs-wrap');
const secondQuestion = (page: Page) =>
  questions(page).getByRole('button', { name: /^Question 2 of 3: Which area should I focus on\?/ });

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

test.describe('question cards', () => {
  let repo: CrewRepo;

  test.beforeEach(async () => {
    await resetCrew();
    repo = crewRepo();
  });

  test.afterEach(() => repo.remove());

  test('a pending question card sits under the reply, in view above the composer, and leaves a draft alone', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await autoContinueAfter(page, null);
    await crewChat(page, repo, 'Auto-edit');
    await send(page, THREE);
    await message(page).fill('a draft I am still typing');
    await expect(questions(page)).toBeVisible({ timeout: 30_000 });

    await expect(message(page)).toBeFocused();
    await expect(message(page)).toHaveValue('a draft I am still typing');
    await expect(questions(page).getByRole('listitem')).toHaveCount(3);

    const reply = thread(page).getByText('How deep should it go? My guess');
    const card = (await questions(page).boundingBox())!;
    const text = (await reply.boundingBox())!;
    const scroller = (await thread(page).boundingBox())!;
    const composer = (await page.locator('.composer').boundingBox())!;
    expect(card.y).toBeGreaterThan(text.y);
    expect(card.y).toBeGreaterThanOrEqual(scroller.y);
    expect(card.y + card.height).toBeLessThanOrEqual(scroller.y + scroller.height);
    expect(card.y + card.height).toBeLessThanOrEqual(composer.y);
    await expect(questions(page).getByRole('button', { name: 'Send' })).toBeInViewport();
    await expect(questions(page).getByRole('button', { name: 'Stop' })).toBeInViewport();
    await expect(page.getByRole('group', { name: QUESTIONS })).toHaveCount(1);

    const turnHead = thread(page).locator('.ai-head').last();
    await expect(turnHead.locator('.ai-jev')).toHaveText('Jev: found it unclear');
    await expect(turnHead.getByRole('button', { name: /^Task: / })).toHaveText('task 2 of 3');
    await expect(thread(page).locator('.taskc')).toHaveCount(0);
    await shot(page, 'card-1280x720');

    await thread(page).evaluate((element) => element.scrollTo({ top: 0 }));
    await secondQuestion(page).click();
    await questions(page).getByRole('button', { name: 'Explorer' }).click();
    await questions(page).getByRole('button', { name: 'Send' }).click();
    const answered = thread(page).getByRole('group', { name: QUESTIONS });
    await expect(answered).toContainText('Which area should I focus on? → Explorer');
    await expect(answered.getByRole('button', { name: 'Send' })).toHaveCount(0);
  });

  test('an answered question card stays on screen while the crew takes over the turn', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await autoContinueAfter(page, null);
    await crewChat(page, repo, 'Auto-edit');
    await send(page, 'Make the reports better #build #vague #questions');
    await expect(questions(page)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const scope = window as unknown as { cardOpacity: number[] };
      scope.cardOpacity = [];
      const shown = (card: Element | null) => {
        let opacity = card ? 1 : 0;
        for (let node = card; node && !node.classList.contains('col'); node = node.parentElement) {
          opacity *= Number(getComputedStyle(node).opacity);
        }
        return opacity;
      };
      const sample = () => {
        scope.cardOpacity.push(shown(document.querySelector('.thread .appr.ck.clarify')));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await questions(page).getByRole('button', { name: 'Usage' }).click();
    await questions(page).getByRole('button', { name: 'Send' }).click();
    await expect(agentBlock(page, 'Bolt')).toBeVisible({ timeout: 30_000 });
    await expect(questions(page)).toContainText('Which report? → Usage');
    await page.waitForTimeout(400);
    const opacity = await page.evaluate(
      () => (window as unknown as { cardOpacity: number[] }).cardOpacity,
    );
    expect(opacity.length).toBeGreaterThan(20);
    expect(Math.min(...opacity)).toBeGreaterThan(0.99);
  });

  test('answering a question card after scrolling up brings the thread back to the latest', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 560 });
    await autoContinueAfter(page, null);
    await crewChat(page, repo, 'Auto-edit');
    await send(page, `${'Some background on the repo first. '.repeat(40)}${THREE}`);
    await expect(questions(page)).toBeVisible({ timeout: 30_000 });
    const gap = () =>
      thread(page).evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      );
    const jump = page.getByRole('button', { name: 'Jump to latest' });
    await thread(page).evaluate((element) => element.scrollTo({ top: 0 }));
    await expect(jump).toBeVisible();
    expect(await gap()).toBeGreaterThan(80);

    await secondQuestion(page).dispatchEvent('click');
    await questions(page).getByRole('button', { name: 'Explorer' }).dispatchEvent('click');
    await questions(page).getByRole('button', { name: 'Send' }).dispatchEvent('click');
    await expect(jump).toBeHidden();
    await expect(page.locator('.crew-foot')).toContainText('Done', { timeout: 60_000 });
    await expect.poll(gap).toBeLessThanOrEqual(2);
    await expect(jump).toBeHidden();
  });

  test('several quick answers and typed words go as one answer; Enter sends and Shift+Enter adds a line', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await autoContinueAfter(page, null);
    await crewChat(page, repo, 'Auto-edit');
    await send(page, THREE);
    await expect(questions(page)).toBeVisible({ timeout: 30_000 });
    const sendButton = questions(page).getByRole('button', { name: 'Send' });
    await expect(sendButton).toBeDisabled();

    await secondQuestion(page).click();
    const picks = questions(page).getByRole('group', {
      name: 'Quick answers to question 2, choose any',
    });
    const pressed = picks.locator('[aria-pressed="true"]');
    await picks.getByRole('button', { name: 'Explorer' }).click();
    await picks.getByRole('button', { name: 'Pulse' }).click();
    await picks.getByRole('button', { name: 'Views' }).click();
    await expect(pressed).toHaveCount(3);
    await picks.getByRole('button', { name: 'Views' }).click();
    await expect(pressed).toHaveText([/^Pulse/, 'Explorer']);
    await expect(sendButton).toBeEnabled();

    const area = questions(page).getByRole('textbox', { name: 'Which area should I focus on?' });
    const oneLine = (await area.boundingBox())!.height;
    await area.fill('focus on tests');
    await area.press('Shift+Enter');
    await area.pressSequentially('and docs');
    await expect(area).toHaveValue('focus on tests\nand docs');
    expect((await area.boundingBox())!.height).toBeGreaterThan(oneLine);
    await expect(pressed).toHaveCount(2);
    await expect(sendButton).toBeVisible();

    const edges = await questions(page).evaluate((card) => {
      const boxes = [
        ...card.querySelectorAll('textarea, .ck-foot, .ask-opt, .ask-line, .ask-q-text'),
      ].map((element) => element.getBoundingClientRect());
      const fields = [...card.querySelectorAll('textarea')].map((element) =>
        element.getBoundingClientRect(),
      );
      const foot = card.querySelector('.ck-foot .btn')!.getBoundingClientRect();
      const outer = card.getBoundingClientRect();
      return {
        lefts: [...new Set(boxes.map((box) => Math.round(box.left - outer.left)))],
        rights: [...new Set(fields.map((box) => Math.round(outer.right - box.right)))],
        below: Math.round(outer.bottom - foot.bottom),
      };
    });
    expect(edges.lefts).toEqual([40]);
    expect(edges.rights).toEqual([14]);
    expect(edges.below).toBe(12);
    await shot(page, 'picked');

    await questions(page).getByRole('button', { name: 'Answer in your own words' }).click();
    const own = questions(page).getByRole('textbox', { name: 'Answer in your own words' });
    await expect(own).toBeFocused();
    await own.fill('keep it short');
    await own.press('Enter');
    const answered = thread(page).getByRole('group', { name: QUESTIONS });
    await expect(answered.getByRole('button', { name: 'Send' })).toHaveCount(0);
    const asked = answered.getByRole('listitem');
    await expect(asked).toHaveText([
      'What would you like next? Best guess: Deep dive on one feature',
      'Which area should I focus on? → Pulse, Explorer — plus: focus on tests and docs',
      /^How deep should it go\? Best guess: /,
    ]);
    await expect(answered.getByRole('status')).toHaveText('Answered.“keep it short”');
    await shot(page, 'answered');
  });

  test('the countdown belongs to the server: it survives a reload and stops when an answer field takes focus', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await autoContinueAfter(page, 40);
    await crewChat(page, repo, 'Auto-edit');
    await send(page, THREE);
    const counting = questions(page).getByRole('button', {
      name: /^Going with my best guesses in \d+s$/,
    });
    await expect(counting).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_500);
    await page.reload();
    await expect(counting).toBeVisible({ timeout: 30_000 });
    const left = Number((await counting.textContent())!.match(/(\d+)s$/)![1]);
    expect(left).toBeLessThan(40);
    expect(left).toBeGreaterThan(10);

    const held = page.waitForResponse((response) => /\/hold$/.test(response.url()));
    await questions(page).getByRole('textbox', { name: 'What would you like next?' }).focus();
    await expect(counting).toHaveCount(0);
    await expect(
      questions(page).getByRole('button', { name: 'Go with my best guesses' }),
    ).toBeVisible();
    expect((await held).ok()).toBe(true);
    await page.reload();
    await expect(questions(page)).toBeVisible({ timeout: 30_000 });
    await expect(counting).toHaveCount(0);
  });

  test('the chat fits from a narrow window to a wide one, with and without the work panel', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await autoContinueAfter(page, null);
    await crewChat(page, repo, 'Auto-edit');
    await send(page, THREE);
    await expect(questions(page)).toBeVisible({ timeout: 30_000 });

    for (const width of [1728, 1440, 1024, 720]) {
      await page.setViewportSize({ width, height: 900 });
      for (const open of width > 1100 ? [true, false] : [false]) {
        await setPanel(page, open);
        await expect(questions(page)).toBeInViewport();
        await expect(message(page)).toBeVisible();
        expect(await pageScroll(page), `page scroll at ${width}`).toBe(0);
        expect(await spilled(page), `spill at ${width}, panel ${open}`).toEqual([]);
        await expect
          .poll(async () => {
            const card = (await questions(page).boundingBox())!;
            const scroller = (await thread(page).boundingBox())!;
            return card.x >= scroller.x && card.x + card.width <= scroller.x + scroller.width;
          })
          .toBe(true);
        await shot(page, `${width}-${open ? 'panel' : 'no-panel'}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(rail(page)).toBeVisible();
    const tasks = rail(page).getByRole('region', { name: 'Tasks' });
    await expect(tasks.getByRole('listitem')).toHaveCount(3);
    await expect(tasks.locator('li[aria-current="step"]').first()).toBeVisible();
    await expect(thread(page).getByRole('button', { name: /^Task: / })).toHaveCount(0);
    await tasks.getByRole('button', { name: /tasks done\. Open the work panel$/ }).click();
    await expect(workPanel(page).getByRole('tab', { name: 'Tasks' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
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
    await expect(turnHead.locator('.ai-jev')).toHaveText('Jev not connected');
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

  test('a finished task lists in the rail on a roomy window, and keeps one line in the thread without it', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await send(page, 'Fix the date divider #plan');
    await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 20_000 });
    const tasks = rail(page).getByRole('region', { name: 'Tasks' });
    await expect(tasks.getByRole('listitem')).toHaveCount(6);
    await expect(tasks).toContainText('6 of 6');
    await expect(tasks.getByRole('listitem').first()).toContainText('Done:');
    await expect(thread(page).locator('.taskc')).toHaveCount(0);
    await shot(page, 'status-tasks-rail');

    await rail(page).getByRole('button', { name: 'Hide context rail' }).click();
    await expect(thread(page).locator('.taskc')).toContainText('Task 6/6 · Done');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(thread(page).locator('.taskc')).toContainText('Task 6/6 · Done');
  });
});
