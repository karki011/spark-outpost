import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  CREW_REQUEST,
  agentBlock,
  agentHead,
  allowEdit,
  card,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

const SHOTS = process.env.ORCH_SCREENSHOTS ?? '';
const THEMES = ['graphite', 'apricot', 'void', 'fjord', 'moss', 'contrast', 'system'];

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

async function startComplex(page: Page) {
  await crewChat(page, repo, 'Balanced');
  await send(page, `${CREW_REQUEST} #build #crew`);
  const plan = card(page, /Approve the plan/);
  await expect(plan).toBeVisible({ timeout: 30_000 });
  return plan;
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });
const asking = (page: Page) => page.getByRole('button', { name: /^Needs your input Move date/ });

test('Balanced: the plan, one Builder carrying it with an edit approval, the Critic, then Keep', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const plan = await startComplex(page);
  const turn = page.locator('.crew-turn');
  await expect(turn.locator('.jevline')).toContainText(
    'Jev: simple · plan → execute → review · models by Jev · 0.81',
  );
  await expect(turn.locator('.jevline .cat-chip')).toHaveText('Bug fix');
  await expect(agentHead(page, 'Jev')).toContainText('Waiting for you');
  await expect(agentHead(page, 'Sketch')).toContainText('Architect');
  await expect(agentHead(page, 'Sketch')).toContainText('Opus 5.5 · high');
  await expect(plan.getByRole('list', { name: 'Plan' }).getByRole('listitem')).toHaveCount(3);
  await expect(plan).toContainText('Plan v1 · 3 steps');
  await expect(asking(page)).toBeVisible();

  const work = panel(page);
  const waiting = work.getByRole('list', { name: 'Waiting for you' });
  await expect(waiting).toContainText('Approve the plan');
  await expect(work.getByRole('list', { name: 'Remaining' })).toContainText(
    'Update src/turns.ts for step 3',
  );
  await page.locator('.thread').evaluate((element) => (element.scrollTop = 0));
  await waiting.getByRole('button', { name: 'Review' }).click();
  await expect(plan).toBeInViewport();
  await shot(page, 'plan');
  await plan.getByRole('button', { name: 'Approve' }).click();
  await expect(plan).toContainText('Plan approved.');

  const edit = card(page, /Change a file\?/);
  await expect(edit).toBeVisible({ timeout: 30_000 });
  const builder = agentBlock(page, 'Bolt');
  await expect(builder.getByRole('group', { name: /Change a file\?/ })).toBeVisible();
  await expect(agentHead(page, 'Bolt')).toContainText('Waiting for you');
  await expect(agentHead(page, 'Bolt')).toContainText('Builder');
  await expect(agentHead(page, 'Bolt')).toContainText('Sonnet 5 · medium');
  await expect(
    page.getByRole('button', {
      name: /^Asking permission Move date.*Bolt wants to edit notes\.txt/,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('1 chat needs your input')).toBeVisible();
  await expect(waiting).toContainText('Waiting for you: Write notes.txt');
  await expect(waiting.getByText('Waiting for you: Write notes.txt')).toHaveAttribute(
    'title',
    path.join(repo.root, 'notes.txt'),
  );
  await expect(work).toContainText(
    'Bolt · Builder · Sonnet 5 · medium: Update src/dates.ts for step 1',
  );

  await work.getByRole('tab', { name: 'Crew' }).click();
  const crew = work.getByRole('list', { name: 'Crew' }).getByRole('listitem');
  await expect(crew).toHaveCount(3);
  await expect(crew.nth(0)).toContainText('Dispatcher · router');
  await expect(crew.nth(1)).toContainText('SketchDone');
  await expect(crew.nth(1)).toContainText('Architect · Opus 5.5 · high');
  await expect(crew.nth(2)).toContainText('BoltWaiting for you');
  await expect(crew.nth(2)).toContainText('Builder · Sonnet 5 · medium');

  const tvButton = page.getByRole('button', { name: 'Agent TV' });
  await tvButton.click();
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  for (const name of ['Jev', 'Sketch', 'Bolt']) {
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
  await expect(keep).toContainText('1 file changed.');
  await expect(agentHead(page, 'Hawk')).toContainText('6 Sol · medium');
  await expect(agentBlock(page, 'Hawk')).toContainText('Verdict: looks good');
  await expect(waiting).toContainText('Keep these changes?');
  await expect(work.getByRole('list', { name: 'Remaining' })).toHaveCount(0);
  await shot(page, 'keep');
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();

  await expect(turn.locator('.crew-foot')).toContainText('Done 3 agents', { timeout: 30_000 });
  await agentHead(page, 'Bolt').click();
  await expect(agentBlock(page, 'Bolt')).toContainText('Built step 1, 2, 3.');
  await expect(asking(page)).toHaveCount(0);
  expect(repo.notes()).toBe('start\nstep 1\nstep 2\nstep 3\n');
  await expect(page.getByRole('button', { name: 'Revert to before this run' })).toBeVisible();
  await work.getByRole('tab', { name: 'Crew' }).click();
  await expect(work.getByRole('list', { name: 'Crew' }).getByRole('listitem')).toHaveCount(4);

  await work.getByRole('tab', { name: 'Plan' }).click();
  const planned = work.locator('.plist li');
  await expect(planned).toHaveCount(3);
  await expect(planned.getByRole('img', { name: 'Done' })).toHaveCount(3);
  await expect(work.locator('.vbadge')).toHaveText('v5');
  await work.getByRole('button', { name: 'History · 5 versions' }).click();
  const done = work.locator('.phist .pd.comp');
  await expect(done).toHaveCount(3);
  await expect(done.first()).toHaveText('✓Done: Update src/turns.ts for step 3');
  await expect(done.last()).toHaveText('✓Done: Update src/dates.ts for step 1');
  await expect(work.locator('.phist .pd.stat')).toHaveCount(3);
  await expect(work.locator('.phist .pv.old')).toHaveCount(0);
});

test('Full auto asks only for what always asks, like pushing', async ({ page }) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Full auto');
  await send(page, `${CREW_REQUEST} #build #crew #push`);
  const push = card(page, /Run a command\?/);
  await expect(push).toBeVisible({ timeout: 30_000 });
  await expect(push.locator('pre')).toHaveText('$ git push origin main');
  await expect(push).toContainText('Pushing always asks');
  await push.getByRole('button', { name: 'Deny' }).click();

  const turn = page.locator('.crew-turn');
  await expect(turn.locator('.crew-foot')).toContainText('Done 3 agents', { timeout: 30_000 });
  await expect(
    page.getByRole('group', { name: /Approve the plan|Keep these|Change a file/ }),
  ).toHaveCount(0);
  for (const name of ['Sketch', 'Bolt', 'Hawk']) {
    await expect(agentHead(page, name)).toBeVisible();
  }
  await expect(agentHead(page, 'Rivet')).toHaveCount(0);
  expect(repo.notes()).toBe('start\nstep 1\nstep 2\nstep 3\n');
});

test('on a phone the crew fits and Agent TV opens as a sheet that stays across chats', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startComplex(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.crew-turn')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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
  await page.getByRole('button', { name: 'Agent TV' }).click();
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible();
  await expect(tv).toBeVisible();
  await tv.getByRole('button', { name: /^Sketch,/ }).click();
  await tv
    .getByRole('group', { name: / details$/ })
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page.locator('.crew-turn')).toBeVisible();
});

test('screenshots of the crew in every theme', async ({ page }) => {
  test.skip(!SHOTS, 'Set ORCH_SCREENSHOTS to a folder to capture screenshots.');
  test.setTimeout(120_000);
  await startComplex(page);
  for (const theme of THEMES) {
    await page.evaluate((id) => localStorage.setItem('spark-outpost.theme', id), theme);
    await page.reload();
    await page.getByRole('button', { name: 'Agent TV' }).click();
    await expect(page.getByRole('dialog', { name: 'Agent TV' })).toBeVisible();
    await shot(page, `desktop-${theme}`);
  }
});
