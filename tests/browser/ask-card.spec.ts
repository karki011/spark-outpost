import { expect, test, type Page } from '@playwright/test';
import {
  autoContinueAfter,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

const THREE = 'Tell me anything about this repo #build #vague #questions #three';
const LONG = 'Split the reports page #build #vague #questions #longoptions';
const QUESTIONS = /Spark has a (few questions|question)/;

const thread = (page: Page) => page.locator('.thread');
const card = (page: Page) => thread(page).getByRole('group', { name: QUESTIONS });
const option = (page: Page, name: string | RegExp) => card(page).getByRole('button', { name });
const line = (page: Page, number: number) =>
  card(page).getByRole('button', { name: new RegExp(`^Question ${number} of 3: `) });
const sendButton = (page: Page) => card(page).getByRole('button', { name: 'Send' });

async function ask(page: Page, repo: CrewRepo, request: string) {
  await autoContinueAfter(page, null);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, request);
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
}

test.describe('ask card', () => {
  let repo: CrewRepo;

  test.beforeEach(async () => {
    await resetCrew();
    repo = crewRepo();
  });

  test.afterEach(() => repo.remove());

  test('several questions stack with one open, and the keyboard picks, continues and sends', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await ask(page, repo, THREE);

    await expect(card(page).getByRole('listitem')).toHaveCount(3);
    await expect(card(page).getByRole('group', { name: 'Question 1 of 3' })).toBeVisible();
    await expect(line(page, 2)).toHaveText('Which area should I focus on?Best guess: Pulse');
    await expect(line(page, 3)).toBeVisible();
    await expect(card(page).getByRole('textbox')).toHaveCount(1);
    await expect(sendButton(page)).toBeDisabled();

    const first = option(page, /^Deep dive on one feature/);
    await first.focus();
    await expect(first).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('2');
    await expect(option(page, 'Testing & tooling setup')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(option(page, 'Recent changes summary')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(option(page, 'Recent changes summary')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('3');
    await expect(option(page, 'Recent changes summary')).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('Escape');
    await expect(sendButton(page)).toBeEnabled();
    await expect(card(page).getByRole('group', { name: 'Question 1 of 3' })).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(line(page, 1)).toHaveText('What would you like next?→ Testing & tooling setup');
    await expect(card(page).getByRole('group', { name: 'Question 2 of 3' })).toBeVisible();
    await expect(option(page, /^Pulse/)).toBeFocused();
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowDown');
    const typed = card(page).getByRole('textbox', { name: 'Which area should I focus on?' });
    await expect(typed).toBeFocused();
    await page.keyboard.type('2 the map');
    await expect(typed).toHaveValue('2 the map');
    await expect(option(page, 'Explorer')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter');

    await expect(card(page).getByRole('group', { name: 'Question 3 of 3' })).toBeVisible();
    await expect(line(page, 2)).toHaveText('Which area should I focus on?→ 2 the map');
    await line(page, 1).click();
    await expect(option(page, 'Testing & tooling setup')).toHaveAttribute('aria-pressed', 'true');
    await line(page, 3).click();
    await expect(option(page, /^Walkthrough \+ gotchas/)).toBeFocused();
    await page.keyboard.press('Enter');

    const answered = thread(page).getByRole('group', { name: QUESTIONS });
    await expect(answered.getByRole('button', { name: 'Send' })).toHaveCount(0);
    await expect(answered.getByRole('listitem')).toHaveText([
      'What would you like next? → Testing & tooling setup',
      'Which area should I focus on? → 2 the map',
      'How deep should it go? Best guess: Walkthrough + gotchas',
    ]);
    await expect(answered.getByRole('status')).toHaveText('Answered.');
  });

  test('long answers fit a 375px phone', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await ask(page, repo, LONG);
    await page.setViewportSize({ width: 375, height: 812 });

    await expect(card(page)).toBeInViewport();
    await expect(sendButton(page)).toBeInViewport();
    await expect(card(page).getByRole('button', { name: 'Stop' })).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    const spill = await card(page).evaluate((element) => {
      const outer = element.getBoundingClientRect();
      return [...element.querySelectorAll('button, textarea, p')].filter((node) => {
        const box = node.getBoundingClientRect();
        return box.left < outer.left || box.right > outer.right;
      }).length;
    });
    expect(spill).toBe(0);

    const toggle = option(page, /^One table with a toggle/);
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await sendButton(page).click();
    const answered = thread(page).getByRole('group', { name: QUESTIONS });
    await expect(answered.getByRole('listitem')).toHaveText([/→ One table with a toggle/]);
    await expect(answered.getByRole('status')).toHaveText('Answered.');
  });
});
