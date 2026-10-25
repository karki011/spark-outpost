import path from 'node:path';
import type { ConversationDetail } from '../../packages/contracts/src/conversations.ts';
import { expect, test, type Page } from '@playwright/test';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';
import { resetWithAgents } from './project-chat-kit.ts';

const SHOTS = process.env.SPARK_REVIEW_SHOTS ?? '';

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), animations: 'disabled' });
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetWithAgents();
  await page.setViewportSize({ width: 1400, height: 900 });
});

async function ask(page: Page, text: string) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  return input;
}

const mood = (page: Page) => page.locator('.msg.ai .mood').last();
const cardsIn = (scope: ReturnType<Page['locator']>) =>
  scope.getByRole('list', { name: 'Sub-agents' }).getByRole('listitem');
const agentsLine = (turn: ReturnType<Page['locator']>) => turn.locator('.sl-text');

test('Agent TV redirects through the lead composer without replacing a draft or sending it', async ({
  page,
}) => {
  const input = await ask(page, 'Split the work #build #subagentshold');
  await expect(page.locator('.msg.ai').last().locator('.turn-working')).toContainText(
    'Running 2 agents',
    {
      timeout: 30_000,
    },
  );
  await input.fill('Keep my draft');
  const before = await page.locator('.msg.user').count();
  await toggleHeaderPane(page, 'Agent TV');
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await expect(cardsIn(tv)).toHaveCount(2);
  await expect(tv.locator('.tv-stage .tv-n')).toHaveCount(3);
  await expect(tv.locator('.tv-stage .tv-n:not(.lead)')).toContainText(['Explore', 'Tests']);
  await expect(cardsIn(tv).first().locator('.chat-face')).toBeVisible();
  await expect(cardsIn(tv).first().locator('.ac-role')).toHaveText('Explorer');
  await expect(cardsIn(tv).nth(1).locator('.ac-role')).toHaveCount(0);
  await shot(page, 'agent-tv-message-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tv.getByRole('button', { name: 'Message lead', exact: true })).toBeVisible();
  for (const button of [
    tv.getByRole('button', { name: 'Message lead', exact: true }),
    tv.getByRole('button', { name: 'Ask lead to redirect' }).first(),
  ]) {
    await expect
      .poll(async () => (await button.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
  }
  await shot(page, 'agent-tv-message-phone.png');
  await page.setViewportSize({ width: 1400, height: 900 });
  await cardsIn(tv).first().getByRole('button', { name: 'Ask lead to redirect' }).click();
  await expect(tv).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(/Keep my draft[\s\S]*Please redirect the sub-agent Explore/);
  await expect(page.locator('.msg.user')).toHaveCount(before);
  const draft = await input.inputValue();
  await toggleHeaderPane(page, 'Agent TV');
  await tv.getByRole('button', { name: 'Message lead', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(draft);
});

test('a turn shows its sub-agents as one line and as cards in the work panel, and stops them with the turn', async ({
  page,
}) => {
  const input = await ask(page, 'Split the work #build #subagentshold');
  const turn = page.locator('.msg.ai').last();
  await expect(turn.locator('.turn-working')).toContainText('Running 2 agents', {
    timeout: 30_000,
  });
  await expect(turn.getByRole('list', { name: 'Agent progress' })).toBeVisible();
  await expect(turn.locator('.sl-worker .sl-name')).toHaveText(['Explorer', 'Tests']);
  await expect(turn.locator('.sl-worker .sl-state')).toHaveText(['Working', 'Working']);
  await expect(turn.locator('.sl-worker .chat-face')).toHaveCount(2);
  await expect(turn.locator('.sl-scout[data-working]')).toHaveCount(0);
  await expect(mood(page)).toHaveText('waiting on 2 sub-agents');
  await expect(turn.locator('.turn-working')).toBeVisible();
  await expect(turn.locator('.trow', { hasText: 'Starting a subagent' })).toHaveCount(0);
  await expect(cardsIn(turn)).toHaveCount(0);
  await expect(turn).not.toContainText('Read routes.ts');

  await turn.getByRole('button', { name: 'View agents' }).click();
  const panel = page.locator('#work-panel');
  const heading = panel.getByRole('heading', { name: 'Agents · 2' });
  await expect(heading).toBeFocused();
  const cards = cardsIn(panel);
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAttribute('data-state', 'working');
  await expect(cards.nth(0)).toContainText('Explore');
  await expect(cards.nth(0)).toContainText('Find the routes');
  await expect(cards.nth(0)).toContainText('Now: Read routes.ts');
  await expect(cards.nth(1)).toContainText('Tests');

  const sidebar = page.getByRole('navigation', { name: 'Chats' });
  await expect(sidebar.locator('.row.st-running.active')).toHaveCount(1);

  await input.fill('still typing');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('still typing');
  await expect(page.locator('.hint').first()).toHaveAttribute(
    'title',
    /^Enter to send to the agent now, while it waits on 2 sub-agents/,
  );
  await shot(page, 'subagents-chat-waiting.png');

  await toggleHeaderPane(page, 'Agent TV');
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await expect(cardsIn(tv)).toHaveCount(2);
  await tv.getByRole('radio', { name: 'List' }).click();
  await expect(tv.getByRole('list', { name: 'Running' })).toContainText(
    /waiting on 2 sub-agents/i,
    {
      timeout: 10_000,
    },
  );
  await shot(page, 'subagents-agent-tv.png');
  await page.keyboard.press('Escape');

  await input.fill('Also check the tests');
  await input.press('Enter');
  await expect(page.locator('.qs-text', { hasText: 'Also check the tests' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(mood(page)).toHaveText('waiting on 2 sub-agents');
  await shot(page, 'subagents-enter-while-waiting.png');

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(agentsLine(turn)).toHaveText('2 agents · 2 stopped', { timeout: 30_000 });
  await expect(turn.locator('.sl-worker .sl-state')).toHaveText(['Stopped', 'Stopped']);
  await expect(turn.locator('.sl-scout[data-working]')).toHaveCount(0);
});

test('a finished turn keeps its sub-agents, nested ones under their parent, after a reload', async ({
  page,
}) => {
  await ask(page, 'Split the work #build #subagents');
  await expect(mood(page)).toHaveText('done', { timeout: 30_000 });
  const turn = page.locator('.msg.ai').last();
  await expect(agentsLine(turn)).toHaveText('3 agents · 2 done · 1 failed');
  await expect(turn.locator('.md').last()).toContainText('All done');
  await expect(turn).not.toContainText('child words');
  await expect(turn).not.toContainText('pnpm test');

  await page.reload();
  const again = page.locator('.msg.ai').last();
  await again.getByRole('button', { name: 'View agents' }).click();
  const panel = page.locator('#work-panel');
  const cards = cardsIn(panel);
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Explore');
  await expect(cards.nth(1)).toContainText('Nested');
  await expect(cards.nth(1)).toHaveAttribute('data-nested', 'true');
  await expect(cards.nth(2)).toContainText('Tests');
  await expect(cards.nth(2)).toContainText('Failed');
  await expect(cards.nth(0)).toContainText('41s · 3K tok');
  const explore = panel.getByRole('button', { name: 'Explore' });
  await explore.focus();
  await page.keyboard.press('Enter');
  await expect(explore).toHaveAttribute('aria-expanded', 'true');
  const steps = panel.getByRole('list', { name: 'Steps of Explore' }).getByRole('listitem');
  await expect(steps).toHaveText([
    'Starting a subagent',
    'Read routes.ts',
    'Edit routes.ts',
    'pnpm test',
  ]);
  await expect(cards.nth(0)).toContainText('Changed routes.ts');
  await expect(cards.nth(0)).toContainText('Ran pnpm test');
  await expect(cards.nth(0)).toContainText('Found 4 routes and moved them.');
  await shot(page, 'subagents-chat-finished.png');
  await page.getByRole('tab', { name: 'Cost' }).click();
  await expect(page.locator('.cost-split')).toContainText('Sub-agents 3.4K');
  await expect(page.getByRole('list', { name: 'Usage by sub-agent' })).toContainText('Explore');
  await toggleHeaderPane(page, 'Agent TV');
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await expect(cardsIn(tv)).toHaveCount(3);
  await expect(tv.getByRole('button', { name: 'Ask lead to redirect' })).toHaveCount(0);
});

test('a Claude turn that ends with background work running waits on it instead of saying done', async ({
  page,
}) => {
  const input = await ask(page, 'Check the schema #build #backgroundforever');
  const turn = page.locator('.msg.ai').last();
  await expect(mood(page)).toHaveText('waiting on 1 background agent', { timeout: 30_000 });
  await expect(turn.locator('.turn-working')).toHaveCount(0);
  await expect(turn.locator('.background-work')).toContainText(
    'Still running in the background: Schema.',
  );
  await expect(turn.locator('.md').last()).toContainText("I'll send the write-up once it reports.");
  const sidebar = page.getByRole('navigation', { name: 'Chats' });
  await expect(sidebar.locator('.row.st-running.active')).toHaveCount(1);
  await input.fill('Any news?');
  await expect(page.locator('.hint').first()).toHaveAttribute(
    'title',
    /^Enter to send to the agent now, while it waits on 1 background agent/,
  );
  await input.fill('');
  await shot(page, 'background-waiting.png');

  const stop = turn.getByRole('button', { name: 'Stop background tasks' });
  await stop.focus();
  await expect(stop).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(turn.locator('.background-work')).toHaveCount(0, { timeout: 30_000 });
  await expect(turn).toContainText('Stopped before finishing.');
});

test('a Claude turn picks up again on its own when its background work reports', async ({
  page,
}) => {
  await ask(page, 'Check the schema #build #background');
  const turn = page.locator('.msg.ai').last();
  await expect(turn).toContainText('Schema finished: turns live in events.', { timeout: 30_000 });
  await expect(mood(page)).toHaveText('done');
  await expect(agentsLine(turn)).toHaveText('1 agent · 1 done');
});

test('a finished lead shows stale working workers as inactive after reload', async ({ page }) => {
  await ask(page, 'Split the work #build #subagents');
  await expect(mood(page)).toHaveText('done', { timeout: 30_000 });
  await page.route(/\/api\/conversations\/[^/]+$/, async (route) => {
    const response = await route.fetch();
    const detail = (await response.json()) as ConversationDetail;
    const subagents = Object.fromEntries(
      Object.entries(detail.subagents ?? {}).map(([id, rows]) => [
        id,
        rows.map((row) => ({ ...row, state: 'working', endedAt: null })),
      ]),
    );
    await route.fulfill({ response, json: { ...detail, subagents } });
  });
  await page.reload();
  const turn = page.locator('.msg.ai').last();
  await expect(turn.locator('.sl-state')).toHaveText(['Inactive', 'Inactive', 'Inactive']);
  await turn.getByRole('button', { name: 'View agents' }).click();
  const panel = page.locator('#work-panel');
  await expect(cardsIn(panel)).toHaveCount(3);
  await expect(panel.locator('.ac-now')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Ask lead to redirect' })).toHaveCount(0);
  await toggleHeaderPane(page, 'Agent TV');
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await tv.getByRole('radio', { name: 'Stage', exact: true }).click();
  await expect(tv.locator('.tv-stage .tv-n.inactive')).toHaveCount(3);
  await expect(tv.locator('.tv-stage .tv-n.working')).toHaveCount(0);
  await expect(tv.getByRole('button', { name: 'Ask lead to redirect' })).toHaveCount(0);
  await expect(cardsIn(tv).first()).toContainText('Inactive');
});
