import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  agentBlock,
  agentHead,
  allowEdit,
  card,
  CREW_REQUEST,
  crewChat,
  crewRepo,
  failingCheck,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

const SHOTS = process.env.ORCH_SCREENSHOTS ?? '';
const THEMES = [
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'aurora',
  'iris',
  'contrast',
  'system',
];

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, `crew-${name}.png`) });
}

async function startCrew(page: Page) {
  await crewChat(page, repo, 'Ask before edits');
  await send(page, `${CREW_REQUEST} #build #crew`);
  const edit = card(page, /Change a file\?/);
  await expect(edit).toBeVisible({ timeout: 30_000 });
  return edit;
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });

test('Manual: one task Builder with an edit approval, the Critic, then it keeps the change', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await startCrew(page);
  const turn = page.locator('.crew-turn');
  await expect(turn.locator('.jevline')).toContainText('model by rules');
  await expect(turn.locator('.jevline .cat-chip')).toHaveText('Bug fix');
  const builder = agentBlock(page, 'Bolt');
  await expect(builder.getByRole('group', { name: /Change a file\?/ })).toBeVisible();
  await expect(page.locator('.cstatus')).toContainText('Waiting for you · approve edit notes.txt');
  await expect(agentHead(page, 'Bolt')).toContainText('Waiting for you');
  await expect(agentHead(page, 'Bolt')).toContainText('Builder');
  await expect(agentHead(page, 'Bolt')).toContainText('Opus 5.5high effort');
  await expect(
    page.getByRole('button', {
      name: /^Asking permission Move date.*Bolt wants to edit notes\.txt/,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('1 chat needs your input')).toBeVisible();
  const work = panel(page);
  const waiting = work.getByRole('list', { name: 'Waiting for you' });
  await expect(waiting).toContainText('Waiting for you: Write notes.txt');
  await expect(waiting.getByText('Waiting for you: Write notes.txt')).toHaveAttribute(
    'title',
    path.join(repo.work(), 'notes.txt'),
  );

  await work.getByRole('tab', { name: 'Crew' }).click();
  const crew = work.getByRole('list', { name: 'Crew' }).getByRole('listitem');
  await expect(crew).toHaveCount(2);
  await expect(crew.nth(0)).toContainText('Dispatcher · router');
  await expect(crew.nth(1)).toContainText('BoltWaiting for you');
  await expect(crew.nth(1)).toContainText('Builder · Opus 5.5 · high');

  const tvButton = page.getByRole('button', { name: 'Agent TV' });
  await tvButton.click();
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  for (const name of ['Jev', 'Bolt']) {
    await expect(tv.getByRole('button', { name: new RegExp(`^${name},`) })).toBeVisible();
  }
  await expect(tv.getByRole('button', { name: /^Bolt, waiting for you/ })).toBeVisible();
  await shot(page, 'building');
  await page.keyboard.press('Escape');
  await expect(tv).toBeHidden();
  await expect(tvButton).toBeFocused();
  await work.getByRole('tab', { name: 'Tasks' }).click();

  await allowEdit(page);

  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await expect(keep).toContainText('Kept automatically.');
  await expect(keep.getByRole('button', { name: 'Keep', exact: true })).toHaveCount(0);
  await expect(agentHead(page, 'Hawk')).toContainText('6 Solmedium effort');
  await expect(agentHead(page, 'Hawk')).toContainText('small diff: first review at medium effort');
  await expect(agentBlock(page, 'Hawk')).toContainText('Verdict: looks good');
  await shot(page, 'keep');

  await expect(turn.locator('.crew-foot')).toContainText('Done 2 agents', { timeout: 30_000 });
  await agentHead(page, 'Bolt').click();
  await expect(agentBlock(page, 'Bolt')).toContainText('Built it');
  expect(repo.notes()).toBe('start\nstep 1\n');
  await expect(page.getByRole('button', { name: 'Revert to before this run' })).toBeVisible();
  await work.getByRole('tab', { name: 'Crew' }).click();
  await expect(work.getByRole('list', { name: 'Crew' }).getByRole('listitem')).toHaveCount(3);
});

test.fixme("Review jumps to a second turn's keep card, which renders once", async ({ page }) => {
  test.setTimeout(120_000);
  await crewChat(page, repo, 'Auto-edit');
  await failingCheck(page, repo.root);
  await send(page, `${CREW_REQUEST} #build #crew`);
  const first = card(page, /Keep these changes\?/);
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.getByRole('button', { name: 'Keep', exact: true }).click();
  const turns = page.locator('.crew-turn');
  await expect(turns.first().locator('.crew-foot')).toContainText('Done', { timeout: 30_000 });

  await send(page, 'Also tidy the heading. #build');
  const keep = turns.nth(1).getByRole('group', { name: /Keep these changes\?/ });
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.cstatus')).toContainText('Waiting for you · Keep these changes?');
  const anchor = await keep.getAttribute('id');
  expect(anchor).toMatch(/^approval-/);
  await expect(page.locator(`[id="${anchor}"]`)).toHaveCount(1);
  await expect(turns.first().getByRole('group', { name: /Keep these changes\?/ })).toHaveCount(1);

  await page.locator('.thread').evaluate((element) => (element.scrollTop = 0));
  const waiting = panel(page).getByRole('list', { name: 'Waiting for you' });
  await waiting.getByRole('button', { name: 'Review' }).click();
  await expect(keep).toBeInViewport();
});

test("Full auto asks for nothing, keeps by itself, and refuses the Builder's own push", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Full auto');
  await send(page, `${CREW_REQUEST} #build #crew #push`);

  const turn = page.locator('.crew-turn');
  await expect(turn.locator('.crew-foot')).toContainText('Done 2 agents', { timeout: 30_000 });
  await expect(page.getByRole('group', { name: /Change a file|Run a command/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: /Keep these/ })).toContainText(
    'Kept by Full auto → PR.',
  );
  await agentHead(page, 'Bolt').click();
  await agentBlock(page, 'Bolt')
    .getByRole('button', { name: /^\d+ steps$/ })
    .click();
  await expect(agentBlock(page, 'Bolt')).toContainText("Only this chat's own branch can be pushed");
  for (const name of ['Bolt', 'Hawk']) {
    await expect(agentHead(page, name)).toBeVisible();
  }
  expect(repo.notes()).toBe('start\nstep 1\n');
});

test('on a phone the crew fits and Agent TV opens as a sheet that stays across chats', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startCrew(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.crew-turn')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const roleOverNext = await page.locator('.crew-turn .agent-head').evaluateAll((heads) =>
    heads.map((head) => {
      const role = head.querySelector('.agent-who .agent-role')!.getBoundingClientRect();
      const next = head.querySelector('.agent-state, .ah-meta')?.getBoundingClientRect();
      return next ? Math.round(role.right - next.left) : 0;
    }),
  );
  expect(roleOverNext.length).toBeGreaterThan(0);
  expect(Math.max(...roleOverNext)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Agent TV' }).click();
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await expect
    .poll(async () => {
      const box = await tv.boundingBox();
      return box ? [Math.round(box.x), Math.round(box.width)] : null;
    })
    .toEqual([8, 374]);
  await tv.getByRole('button', { name: 'Close Agent TV' }).click();
  await expect(tv).toBeHidden();

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('button', { name: 'Agent TV', exact: true }).click();
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByText('What should we work on?')).toBeVisible();
  await expect(tv).toBeVisible();
  await tv.getByRole('button', { name: /^Bolt,/ }).click();
  await tv
    .getByRole('group', { name: / details$/ })
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page.locator('.crew-turn')).toBeVisible();
});

test('screenshots of the crew in every theme', async ({ page }) => {
  test.skip(!SHOTS, 'Set ORCH_SCREENSHOTS to a folder to capture screenshots.');
  test.setTimeout(120_000);
  await startCrew(page);
  for (const theme of THEMES) {
    await page.evaluate((id) => localStorage.setItem('spark-outpost.theme', id), theme);
    await page.reload();
    await page.getByRole('button', { name: 'Agent TV' }).click();
    await expect(page.getByRole('dialog', { name: 'Agent TV' })).toBeVisible();
    await shot(page, `desktop-${theme}`);
  }
});
