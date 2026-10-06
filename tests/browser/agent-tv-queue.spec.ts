import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  agentBlock,
  allowEdit,
  card,
  CREW_REQUEST,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

const SHOTS = process.env.AGENT_TV_QUEUE_SHOTS ?? '';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('tv-fresh')) return;
    sessionStorage.setItem('tv-fresh', '1');
    localStorage.removeItem('spark-outpost.agent-tv');
  });
});

test.afterEach(() => repo.remove());

const tvOf = (page: Page) => page.getByRole('dialog', { name: 'Agent TV' });
const strip = (page: Page) => page.getByRole('region', { name: /^\d+ queued$/ });
const queued = (page: Page) =>
  page.getByRole('list', { name: 'Queued messages' }).getByRole('listitem');
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function noAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

async function waitingCrew(page: Page) {
  await crewChat(page, repo, 'Ask before edits');
  await send(page, `${CREW_REQUEST} #build #crew`);
  await expect(card(page, /Change a file\?/)).toBeVisible({ timeout: 30_000 });
}

async function builderName(page: Page): Promise<string> {
  const head = page
    .locator('.crew-turn .agent-head, .crew-turn .agent-fold')
    .filter({ has: page.locator('.agent-role', { hasText: /^Builder$/ }) })
    .first()
    .locator('.agent-name');
  return (await head.textContent())!.trim();
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

test('message the Builder from Agent TV while it waits, and it reads it at its next step', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await waitingCrew(page);
  const name = await builderName(page);
  await page.getByRole('button', { name: 'Agent TV' }).click();
  const tv = tvOf(page);
  await tv.getByRole('radio', { name: 'List' }).click();
  const open = tv.getByRole('button', { name: `Message ${name}` });
  await open.click();

  const dialog = page.getByRole('dialog', { name: `Message ${name}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: `Message to ${name}` })).toBeFocused();
  await expect(dialog).toContainText('Waiting for you');
  await page.keyboard.type('Also log the date you parse.');
  await dialog.getByRole('button', { name: `Send to ${name}` }).click();
  await expect(dialog.getByRole('status')).toHaveText(
    `Sent to ${name}. It reads this at its next step.`,
  );
  const sent = dialog.getByRole('list', { name: `Your messages to ${name}` });
  await expect(sent).toContainText(`You → ${name}`);
  await expect(sent).toContainText(`${name} reads this at its next step`);
  await noAxeViolations(page, '.mchat');
  await shot(page, 'message-from-tv');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(tv).toBeVisible();
  await expect(open).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(tv).toBeHidden();

  await allowEdit(page);
  const bubble = page.locator('.msg.me.steered', { hasText: 'Also log the date you parse.' });
  await expect(bubble.getByRole('status')).toHaveText(`${name} has it`, { timeout: 30_000 });
  await expect(agentBlock(page, name)).toContainText('Message from the user', { timeout: 30_000 });
  await shot(page, 'message-delivered');
});

test('message a crew member from the Work panel, then continue the finished Builder', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, `${CREW_REQUEST} #build #crew`);
  await expect(page.locator('.crew-foot')).toContainText('Done', { timeout: 45_000 });
  const name = await builderName(page);

  const work = page.getByRole('complementary', { name: 'Work panel' });
  if (!(await work.evaluate((element) => element.classList.contains('on')))) {
    await page.getByRole('button', { name: 'Show work panel' }).click();
  }
  await work.getByRole('tab', { name: 'Crew' }).click();
  await work.getByRole('button', { name: `Message ${name}` }).click();

  const dialog = page.getByRole('dialog', { name: `Message ${name}` });
  await expect(dialog.getByRole('textbox', { name: `Message to ${name}` })).toHaveAttribute(
    'placeholder',
    `${name} has finished. Say what to pick back up…`,
  );
  await dialog.getByRole('textbox').fill('Also add a closing line. #build');
  await noAxeViolations(page, '.mchat');
  await shot(page, 'continue-builder');
  await dialog.getByRole('button', { name: `Continue ${name}` }).click();
  await expect(dialog.getByRole('status')).toHaveText(`${name} is continuing.`);
  await expect(dialog.getByRole('list', { name: `Your messages to ${name}` })).toContainText(
    `${name} picked this up in a new turn`,
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.msg.me').last()).toContainText('Also add a closing line.');
  await expect(page.locator('.crew-turn').last().locator('.crew-foot')).toContainText('Done', {
    timeout: 45_000,
  });
  await expect(agentBlock(page, name).last()).toBeVisible();
});

test('the queue strip edits, reorders, removes and keeps messages, then sends them after the turn @packaged', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await waitingCrew(page);
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
  await noAxeViolations(page, '.qstrip');
  await shot(page, 'queue-strip');

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
  await waitingCrew(page);
  await queue(page, 'Later please');
  await queue(page, 'Do this now');
  await queued(page)
    .filter({ hasText: 'Do this now' })
    .getByRole('button', { name: 'Send now' })
    .click();
  await expect(queued(page)).toHaveCount(1);
  const mine = page.locator('.msg.me');
  await expect(mine.filter({ hasText: 'Do this now' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.crew-turn').first()).toContainText('Stopped');
  await expect(queued(page)).toHaveText([/Later please/]);
  const later = mine.filter({ hasText: 'Later please' });
  await allowEditsUntil(page, async () => (await later.count()) > 0);
  await expect(strip(page)).toHaveCount(0);
});

test('Agent TV keeps following its chat while you look at another one', async ({ page }) => {
  test.setTimeout(90_000);
  await waitingCrew(page);
  const name = await builderName(page);
  await page.getByRole('button', { name: 'Agent TV' }).click();
  const tv = tvOf(page);
  await tv.getByRole('radio', { name: 'List' }).click();
  await expect(tv.getByRole('listitem', { name: `${name} · Builder` })).toBeVisible();

  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(composer(page)).toHaveAttribute('placeholder', /^Ask anything/);
  await expect(tv).toBeVisible();
  await expect(tv.getByRole('listitem', { name: `${name} · Builder` })).toBeVisible();
  await tv.getByRole('button', { name: `Open ${name} in the chat` }).click();
  await expect(card(page, /Change a file\?/)).toBeVisible();
  await expect(tv).toBeVisible();
});
