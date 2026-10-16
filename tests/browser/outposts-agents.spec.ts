import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { send } from './project-chat-kit.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';
import {
  NAME,
  TURN_TIMEOUT,
  chip,
  openOutpost,
  outpostPage,
  post,
  stateOf,
  seeded,
  thread,
} from './outposts-kit.ts';

const SHOTS = process.env.SPARK_REVIEW_SHOTS;
const ASK = 'Which fields does the orders response have?';
const NOTE = 'The table needs a total column.';
const THEMES = [
  ['light', 'light'],
  ['dark', 'graphite'],
] as const;

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

async function inBothThemes(
  page: Page,
  name: string,
  area: string,
  check: () => Promise<void>,
): Promise<void> {
  const root = page.locator('html');
  const before = await root.getAttribute('data-skin');
  for (const [scheme, skin] of THEMES) {
    await root.evaluate((html, value) => (html.dataset.skin = value), skin);
    await animationsSettled(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-${name}-${scheme}.png` });
    await check();
    const results = await new AxeBuilder({ page })
      .include(area)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  }
  await root.evaluate((html, value) => {
    if (value === null) delete html.dataset.skin;
    else html.dataset.skin = value;
  }, before);
}

async function openMember(page: Page, handle: 'fe' | 'api', title: string): Promise<void> {
  await openOutpost(page);
  await chip(page, handle).click();
  await expect(page.locator('.chat-title')).toHaveText(title);
}

test('an agent asks another member, waits for the answer, and both chats and the thread show it', async ({
  page,
}) => {
  await seeded(page);
  await openMember(page, 'fe', 'Frontend');

  await send(page, `#build #spark spark_outpost_ask {"to":"api","text":"${ASK}"}`);
  const result = page.getByText(/spark spark_outpost_ask=/);
  await expect(result).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(result).toContainText(/"state":\s*"answered"/);
  await expect(result).toContainText(/"waited":\s*true/);

  const line = page.locator('section[data-turn] .op-line');
  await inBothThemes(page, 'agent-sent', 'section[data-turn]', async () => {
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(`To @api${ASK}`);
    await expect(line.locator('.op-line-state')).toHaveText('Answered');
  });

  const open = line.getByRole('button', { name: 'Open the request to @api in the outpost' });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(outpostPage(page, NAME)).toBeVisible();
  const asked = post(page, ASK);
  await inBothThemes(page, 'agent-thread', '.main.op', async () => {
    await expect(asked).toBeInViewport();
    await expect(asked.locator('.op-post-head').first()).toContainText('@fenot from youto@api');
    await expect(asked.locator('.op-post-head .chat-face')).toHaveCount(3);
    await expect(stateOf(asked)).toHaveText('Answered');
    await expect(asked.locator('.op-reply .op-mood')).toHaveText('answered');
  });

  await asked.getByRole('button', { name: 'Open @api in chat' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Orders API');
  const header = page.locator('.bubble.from', { hasText: ASK });
  await inBothThemes(page, 'agent-received', 'section[data-turn]', async () => {
    await expect(header.locator('.from-head b')).toHaveText('From @fe');
    await expect(header.locator('.from-note')).toHaveText('not from you');
    await expect(header).not.toContainText('outpost-request');
  });
  await expect(page.locator('section[data-turn] .op-line')).toHaveCount(0);
});

test('an agent leaves a note in the thread, and it starts no work', async ({ page }) => {
  await seeded(page);
  await openMember(page, 'fe', 'Frontend');

  await send(page, `#build #spark spark_outpost_note {"text":"${NOTE}"}`);
  await expect(page.getByText(/spark spark_outpost_note=/)).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(page.locator('section[data-turn] .op-line')).toHaveCount(0);

  await openOutpost(page);
  const note = post(page, NOTE);
  await expect(note.locator('.op-post-head')).toContainText('@fe');
  await expect(note.locator('.op-kind')).toHaveText('note');
  await expect(thread(page).locator('.op-state')).toHaveCount(0);
  await expect(chip(page, 'api')).toContainText('Idle');
});
