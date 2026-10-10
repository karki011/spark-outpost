import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BUILD_REQUEST, chatRepo, projectChat, resetWithAgents, send } from './project-chat-kit.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { shoot } from './docs-seed.ts';
import { openChats } from './navigation.ts';
import { seedChats, type SeedApproval } from './sidebar-seed.ts';

const SHOTS = process.env.COMPOSER_STATUS_SHOTS ?? '';
const GREP = "git grep -l -i 'AI_USER' -- apps/web/src packages/contracts/src";
const LONG_MESSAGE = Array.from({ length: 50 }, (_, index) => `Line ${index + 1}.`).join('\n\n');

const grep: SeedApproval = { kind: 'execute', title: GREP, command: GREP };
const edit: SeedApproval = {
  kind: 'edit',
  title: 'Edit monitors-table.tsx',
  paths: ['/work/app/src/monitors/monitors-table.tsx'],
};
const plan: SeedApproval = {
  kind: 'other',
  title: 'Plan',
  plan: '# Add CSV export\n\n1. Write `src/export.ts`\n2. Add a button',
};

const line = (page: Page) => page.locator('.cstatus');
const shown = (page: Page) => line(page).locator('.cs-wrap');
const waiting = (page: Page) => line(page).getByRole('button', { name: /^Waiting for you/ });
const card = (page: Page, name: RegExp) => page.getByRole('group', { name });

async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  await page.evaluate(() => document.documentElement.removeAttribute('data-skin'));
  await shoot(page, SHOTS, name, page.locator('.main'));
}

async function openWaitingChat(page: Page, approvals: SeedApproval[]) {
  await seedChats([
    {
      title: 'Find the AI user',
      message: LONG_MESSAGE,
      run: { status: 'awaiting_approval' },
      approvals,
    },
  ]);
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText('Find the AI user');
}

async function sql<T extends object>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<T>(text, values);
    return rows;
  } finally {
    await db.end();
  }
}

async function emit(runId: string, event: Record<string, unknown>) {
  await sql(
    `INSERT INTO run_events (run_id, seq, type, payload)
     SELECT $1, coalesce(max(seq), 0) + 1, $2, $3 FROM run_events WHERE run_id = $1`,
    [runId, event.type, JSON.stringify(event)],
  );
}

const stepStarted = (stepName: string) => ({ type: 'STEP_STARTED', stepName });
const stepFinished = (stepName: string) => ({ type: 'STEP_FINISHED', stepName });

test.describe('waiting for you', () => {
  test.beforeEach(async () => {
    await resetTestDatabase({ onboarded: true });
  });

  test('one approval is one line that says what, and jumps to the card', async ({ page }) => {
    test.setTimeout(60_000);
    await openWaitingChat(page, [grep]);
    await expect(waiting(page)).toHaveText(
      /^Waiting for you · approve git grep -l -i 'AI_USER' …\s*Review$/,
    );
    await expect(waiting(page).locator('code')).toHaveText("git grep -l -i 'AI_USER' …");
    await expect(line(page).getByRole('status')).toHaveText(
      "Waiting for you: approve git grep -l -i 'AI_USER' …",
    );
    const lineBox = (await line(page).boundingBox())!;
    const composerBox = (await page.locator('.composer').boundingBox())!;
    expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(composerBox.y + 1);
    expect(lineBox.height).toBeLessThan(44);

    await waiting(page).hover();
    await expect(page.getByRole('tooltip')).toContainText(GREP);
    const axe = await new AxeBuilder({ page }).include('.cstatus').analyze();
    expect(axe.violations).toEqual([]);
    await shots(page, 'waiting-approval');

    const approval = card(page, /Run a command\?/);
    await page.locator('.thread').evaluate((element) => (element.scrollTop = 0));
    await expect(approval).not.toBeInViewport();
    await waiting(page).click();
    await expect(approval).toBeInViewport();
    await expect(approval.getByRole('button', { name: 'Allow', exact: true })).toBeFocused();

    await page.getByRole('textbox', { name: 'Message' }).focus();
    await page.locator('.thread').evaluate((element) => (element.scrollTop = 0));
    await page.keyboard.press('ControlOrMeta+Shift+Y');
    await expect(approval.getByRole('button', { name: 'Allow', exact: true })).toBeFocused();
    await expect(approval).toBeInViewport();
  });

  test('a plan says there is a plan to review', async ({ page }) => {
    await openWaitingChat(page, [plan]);
    await expect(waiting(page)).toContainText('Waiting for you · plan to review');
    await expect(card(page, /Approve the plan\?/)).toBeVisible();
    await shots(page, 'waiting-plan');
  });

  test('several waiting things collapse to a count with a short list', async ({ page }) => {
    await openWaitingChat(page, [grep, edit]);
    await expect(waiting(page)).toContainText('Waiting for you · 2 things');
    await expect(waiting(page)).toHaveAttribute('aria-expanded', 'false');
    await waiting(page).click();
    await expect(waiting(page)).toHaveAttribute('aria-expanded', 'true');
    const list = line(page).getByRole('list', { name: 'Waiting for you' });
    await expect(list.getByRole('button')).toHaveText([
      "approve git grep -l -i 'AI_USER' …",
      'approve edit monitors-table.tsx',
    ]);
    await shots(page, 'waiting-several');
    await list.getByRole('button', { name: 'approve edit monitors-table.tsx' }).click();
    const change = card(page, /Change a file\?/);
    await expect(change.getByRole('button', { name: 'Allow', exact: true })).toBeFocused();
    await expect(list).toHaveCount(0);
  });

  test('with reduced motion the line holds still and still jumps', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWaitingChat(page, [grep]);
    await expect(waiting(page)).toBeVisible();
    const animation = await line(page)
      .locator('.mo-breathe')
      .evaluate((element) => getComputedStyle(element).animationName);
    expect(animation).toBe('none');
    await page.locator('.thread').evaluate((element) => (element.scrollTop = 0));
    await waiting(page).click();
    const approval = card(page, /Run a command\?/);
    await expect(approval).toBeInViewport();
    await expect(approval.getByRole('button', { name: 'Allow', exact: true })).toBeFocused();
  });
});

test('while the agent works the line says what it is doing, then Done', async ({ page }) => {
  test.setTimeout(60_000);
  await resetTestDatabase({ onboarded: true });
  const [chatId] = await seedChats([{ title: 'Tidy the monitors', run: { status: 'running' } }]);
  const [run] = await sql<{ id: string }>('SELECT id FROM runs WHERE conversation_id = $1', [
    chatId,
  ]);
  const runId = run!.id;
  await emit(runId, { type: 'RUN_STARTED', runId, threadId: chatId });
  await openChats(page);
  const turnHead = page.locator('.thread .ai-head');
  await expect(turnHead.locator('.mood')).toHaveText('thinking');
  await expect(shown(page)).toHaveCount(0);
  await expect(page.locator('.thread .dots')).toHaveCount(0);
  await expect(line(page).getByRole('status')).toHaveText('Fake provider is thinking…');
  await page.addStyleTag({ content: '.thread .col { padding-bottom: 200vh; }' });
  await page.locator('.thread').evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(turnHead).not.toBeInViewport();
  await expect(shown(page)).toHaveText('Fake provider is thinking…');

  await emit(runId, stepStarted(`\`${GREP}\``));
  await expect(shown(page)).toHaveText(
    "Fake provider is working · Running git grep -l -i 'AI_USER' -- apps/web/src …",
  );
  await expect(line(page).locator('code')).toHaveText("git grep -l -i 'AI_USER' -- apps/web/src …");
  const axe = await new AxeBuilder({ page }).include('.cstatus').analyze();
  expect(axe.violations).toEqual([]);
  await shots(page, 'running');

  await emit(runId, stepFinished(`\`${GREP}\``));
  await emit(runId, stepStarted('Edit `monitors-table.tsx`'));
  await expect(shown(page)).toHaveText('Fake provider is working · Editing monitors-table.tsx');
  await expect(line(page).locator('.cs-line')).toHaveCount(1);

  await emit(runId, stepFinished('Edit `monitors-table.tsx`'));
  await emit(runId, stepStarted('`GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 gh pr list`'));
  await expect(shown(page)).toHaveText('Fake provider is working · Running gh pr list');
  await expect(shown(page)).not.toContainText('ghp_');
  await expect(line(page).locator('.cs-time')).toHaveText(/^1\ds$/, { timeout: 15_000 });
  await expect(line(page).getByRole('status')).not.toHaveText('');

  await sql(
    `UPDATE runs SET status = 'succeeded', started_at = now() - interval '134 seconds',
       finished_at = now() WHERE id = $1`,
    [runId],
  );
  await emit(runId, { type: 'RUN_FINISHED', runId, threadId: chatId });
  await expect(shown(page)).toHaveText('Done · 2m 14s');
  await shots(page, 'done');
  await expect(line(page).locator('.cs-line')).toHaveCount(0, { timeout: 15_000 });
});

test("the line stays away while a short turn's header is in view, and shows under a long one", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetWithAgents();
  const repo = chatRepo();
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await projectChat(page, repo, 'Auto-edit');
    await send(page, `${BUILD_REQUEST} #build #slowbuild`);
    const head = page.locator('.thread .ai-head').last();
    await expect(head.locator('.mood')).toHaveText('working', { timeout: 30_000 });
    await expect(head).toBeInViewport();
    await expect(shown(page)).toHaveCount(0);
    await expect(line(page).getByRole('status')).toHaveText(/^Claude is /);
    await shots(page, 'head-in-view');

    await page.addStyleTag({ content: '.thread .col { padding-bottom: 200vh; }' });
    const thread = page.locator('.thread');
    await thread.evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect(head).not.toBeInViewport();
    await expect(shown(page)).toHaveText(/^Claude is (working|thinking)/);
    await shots(page, 'head-out-of-view');

    await thread.evaluate((element) => (element.scrollTop = 0));
    await expect(head).toBeInViewport();
    await expect(shown(page)).toHaveCount(0);

    await head.evaluate((element) => {
      element.parentElement!.style.minHeight = '600px';
    });
    await expect(head).toBeInViewport();
    await expect(shown(page)).toHaveText(/^Claude is (working|thinking)/);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(head.locator('.mood')).toHaveText('stopped', { timeout: 30_000 });
  } finally {
    repo.remove();
  }
});
