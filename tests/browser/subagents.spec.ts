import path from 'node:path';
import type { ConversationDetail } from '../../packages/contracts/src/conversations.ts';
import { expect, test, type Page, type Route } from '@playwright/test';
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
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await input.press('Enter');
  return input;
}

const mood = (page: Page) => page.locator('.msg.ai .mood').last();
const cardsIn = (scope: ReturnType<Page['locator']>) =>
  scope.getByRole('list', { name: 'Sub-agents' }).getByRole('listitem');
const agentsLine = (turn: ReturnType<Page['locator']>) => turn.locator('.sl-text');

type SubagentRows = NonNullable<ConversationDetail['subagents']>[string];

async function rewriteSubagents(route: Route, change: (rows: SubagentRows) => SubagentRows) {
  const response = await route.fetch().catch(() => null);
  if (!response) {
    await route.abort().catch(() => undefined);
    return;
  }
  const detail = (await response.json().catch(() => null)) as ConversationDetail | null;
  const json = detail && {
    ...detail,
    subagents: Object.fromEntries(
      Object.entries(detail.subagents ?? {}).map(([id, rows]) => [id, change(rows)]),
    ),
  };
  await route.fulfill(json ? { response, json } : { response }).catch(() => undefined);
}

test('the context rail lists the same workers as Agent TV and preserves their outcomes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 2000, height: 1100 });
  const input = await ask(page, 'Split the work #build #subagentshold');
  const rail = page.getByRole('region', { name: 'Chat context' });
  const crew = rail.getByRole('region', { name: 'Crew' });
  await expect(crew.getByRole('listitem')).toHaveCount(3, { timeout: 30_000 });
  await expect(crew).toContainText('Explore');
  await expect(crew).toContainText('Tests');
  await expect(rail.locator('.tv-n')).toHaveCount(0);
  await input.fill('Keep this draft');
  await crew.getByRole('button', { name: 'Open Agent TV' }).focus();
  await page.keyboard.press('Enter');
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await expect(tv).toBeVisible();
  await expect(tv.locator('.tv-stage .tv-n:not(.lead) > b')).toHaveText(['Explore', 'Tests']);
  await shot(page, 'agent-team-sidebar.png');
  await tv.getByRole('button', { name: 'Close Agent TV' }).click();
  await expect(input).toHaveValue('Keep this draft');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(rail).toContainText('Stopped', { timeout: 30_000 });
  await expect(rail).toContainText('Explore');
  await expect(rail).toContainText('Tests');
  await expect(rail).toContainText('Stopped');
  await page.reload();
  await expect(rail).toContainText('Explore');
  await expect(rail).toContainText('Tests');
});

test('a larger team lists every worker in the rail and the rail scrolls', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 2000, height: 1100 });
  await page.route(/\/api\/conversations\/[^/]+$/, (route) =>
    rewriteSubagents(route, (rows) =>
      rows.length
        ? Array.from({ length: 6 }, (_, index) => ({
            ...rows[0]!,
            id: `worker-${index}`,
            name: `Builder ${index + 1}`,
          }))
        : rows,
    ),
  );
  await ask(page, 'Split the work #build #subagentshold');
  const crew = page
    .getByRole('region', { name: 'Chat context' })
    .getByRole('region', { name: 'Crew' });
  await expect(crew.getByRole('listitem')).toHaveCount(7, { timeout: 30_000 });
  const fits = await crew
    .getByRole('listitem')
    .evaluateAll((rows) => rows.every((row) => row.scrollWidth <= row.clientWidth));
  expect(fits).toBe(true);
  await shot(page, 'agent-team-sidebar-large.png');
  await page.setViewportSize({ width: 1600, height: 440 });
  const rail = page.getByRole('region', { name: 'Chat context' });
  await expect
    .poll(() => rail.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  expect(await rail.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
  await crew.getByRole('button', { name: 'Open Agent TV' }).focus();
  await page.keyboard.press('End');
  await expect
    .poll(() =>
      rail.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
    )
    .toBeLessThan(2);
  await shot(page, 'agent-team-sidebar-short.png');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('Agent TV redirects through the lead composer without replacing a draft or sending it', async ({
  page,
}) => {
  const purpose = `Inspect ${'the routes and their existing boundaries '.repeat(8)}`;
  await page.route(/\/api\/conversations\/[^/]+$/, (route) =>
    rewriteSubagents(route, (rows) =>
      rows.map((row) => ({ ...row, task: `${purpose}\nDo not copy this task body.` })),
    ),
  );
  const input = await ask(page, 'Split the work #build #subagentshold');
  const working = page.locator('.msg.ai').last();
  await expect(working.locator('.sl-worker .sl-state')).toHaveText(['Working', 'Working'], {
    timeout: 30_000,
  });
  await expect(working.locator('.turn-working b')).toHaveText('Working');
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
  expect(draft).toContain(`working on ${purpose.slice(0, 117)}…: `);
  expect(draft).not.toContain('Do not copy this task body.');
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
  await expect(turn.locator('.sl-worker .sl-state')).toHaveText(['Working', 'Working'], {
    timeout: 30_000,
  });
  await expect(turn.locator('.turn-working b')).toHaveText('Working');
  await expect(turn.locator('.turn-working')).not.toContainText('Running');
  await expect(turn.getByRole('list', { name: 'Agent progress' })).toBeVisible();
  await expect(turn.locator('.sl-worker .sl-name')).toHaveText(['Explorer', 'Tests']);
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
  await expect(cards.nth(0)).toContainText('Opus 5.5 · High · 41s · 3K tok');
  await expect(cards.nth(2)).not.toContainText('Opus');
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
    'Still running in the background: 1 agent.',
  );
  await expect(turn.getByRole('list', { name: 'Background work' })).toHaveText('Schema');
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

test('a message queued while the agent only waits on background work reaches the agent', async ({
  page,
}) => {
  const input = await ask(page, 'Check the schema #build #backgroundforever');
  const turn = page.locator('.msg.ai').last();
  await expect(mood(page)).toHaveText('waiting on 1 background agent', { timeout: 30_000 });
  await input.fill('Queued while it waits');
  await input.press('ControlOrMeta+Enter');
  await expect(turn).toContainText('Queued while it waits', { timeout: 15_000 });
  await expect(page.locator('.qs-text', { hasText: 'Queued while it waits' })).toHaveCount(0);
  await expect(mood(page)).toHaveText('waiting on 1 background agent', { timeout: 15_000 });
  await turn.getByRole('button', { name: 'Stop background tasks' }).click();
  await expect(turn.locator('.background-work')).toHaveCount(0, { timeout: 30_000 });
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
  await page.route(/\/api\/conversations\/[^/]+$/, (route) =>
    rewriteSubagents(route, (rows) =>
      rows.map((row) => ({ ...row, state: 'working', endedAt: null })),
    ),
  );
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
