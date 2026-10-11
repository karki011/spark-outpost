import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  BUILD_REQUEST,
  card,
  chatRepo,
  type ChatRepo,
  projectChat,
  resetWithAgents,
  send,
} from './project-chat-kit.ts';

let repo: ChatRepo;

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const strip = (page: Page) => page.getByRole('region', { name: /^\d+ queued$/ });
const queued = (page: Page) =>
  page.getByRole('list', { name: 'Queued messages' }).getByRole('listitem');
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });

async function waitingTurn(page: Page) {
  await projectChat(page, repo, 'Ask before edits');
  await send(page, `${BUILD_REQUEST} #build`);
  await expect(card(page, /Change a file\?/)).toBeVisible({ timeout: 30_000 });
}

async function allowEditsUntil(page: Page, done: () => Promise<boolean>, timeoutMs = 60_000) {
  const allow = card(page, /Change a file\?/)
    .filter({ has: page.getByRole('button', { name: 'Deny' }) })
    .getByRole('button', { name: 'Allow', exact: true });
  const until = Date.now() + timeoutMs;
  while (!(await done())) {
    if (Date.now() > until) throw new Error('The queued messages were not all sent.');
    if (await allow.first().isVisible()) await allow.first().click();
    await page.waitForTimeout(250);
  }
}

async function queue(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
  await expect(queued(page).filter({ hasText: text })).toBeVisible();
}

test('the queue strip edits, reorders, removes and keeps messages, then sends them after the turn @packaged', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await waitingTurn(page);
  await expect(composer(page)).toHaveAttribute(
    'placeholder',
    'Queue a message for when this turn ends',
  );
  await queue(page, 'First queued');
  await queue(page, 'Second queued');
  await queue(page, 'Third queued');
  await expect(strip(page)).toContainText('3 queued');
  await expect(page.locator('.cstatus')).toContainText('3 queued');

  const first = queued(page).nth(0);
  await first.getByRole('button', { name: 'Edit' }).click();
  const editor = first.getByRole('textbox', { name: 'Edit queued message' });
  await editor.fill('First queued, edited');
  await editor.press('Enter');
  await expect(first).toContainText('First queued, edited');

  await queued(page).nth(2).getByRole('button', { name: 'Move up' }).click();
  await expect(queued(page)).toHaveText([/First queued, edited/, /Third queued/, /Second queued/]);
  await queued(page).nth(2).getByRole('button', { name: 'Remove' }).click();
  await expect(queued(page)).toHaveCount(2);
  const results = await new AxeBuilder({ page })
    .include('.qstrip')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.reload();
  await expect(queued(page)).toHaveText([/First queued, edited/, /Third queued/]);

  const mine = page.locator('.msg.me');
  const third = mine.filter({ hasText: 'Third queued' });
  await allowEditsUntil(page, async () => (await third.count()) > 0);
  await expect(strip(page)).toHaveCount(0);
  const texts = await mine.allTextContents();
  const firstAt = texts.findIndex((text) => text.includes('First queued, edited'));
  const thirdAt = texts.findIndex((text) => text.includes('Third queued'));
  expect(firstAt).toBeLessThan(thirdAt);
});

test('Send now stops a turn the agent cannot steer and sends that message first', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await waitingTurn(page);
  await queue(page, 'Later please');
  await queue(page, 'Do this now');
  await queued(page)
    .filter({ hasText: 'Do this now' })
    .getByRole('button', { name: 'Send now' })
    .click();
  await expect(queued(page)).toHaveCount(1);
  const mine = page.locator('.msg.me');
  await expect(mine.filter({ hasText: 'Do this now' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.msg.ai').first()).toContainText('Stopped before finishing.');
  await expect(queued(page)).toHaveText([/Later please/]);
  const later = mine.filter({ hasText: 'Later please' });
  await allowEditsUntil(page, async () => (await later.count()) > 0);
  await expect(strip(page)).toHaveCount(0);
});
