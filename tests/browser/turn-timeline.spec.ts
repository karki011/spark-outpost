import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { pickPermission } from './permissions-kit.ts';
import {
  allowEdit,
  card,
  chatRepo,
  linkedChat,
  send,
  turnDone,
  type ChatRepo,
} from './project-chat-kit.ts';
import { notifyChanged } from './sidebar-seed.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const FLAG_TITLE = 'Fake provider sent data out through git push after reading .env';

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

async function flagAfterEditCard(): Promise<string> {
  const { rows } = await sql(
    `SELECT a.run_id, r.conversation_id FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE a.kind = 'edit' ORDER BY a.created_at DESC LIMIT 1`,
  );
  const { run_id: runId, conversation_id: conversationId } = rows[0] as {
    run_id: string;
    conversation_id: string;
  };
  await sql(
    `INSERT INTO rail_flags (id, run_id, conversation_id, rail, title, paths, inside, originals, created_at)
     SELECT gen_random_uuid(), $1::uuid, $2::uuid, 'sent_out', $3::text, '["example.com"]'::jsonb,
       false, '[]'::jsonb, created_at + interval '1 millisecond'
     FROM approvals WHERE run_id = $1::uuid AND kind = 'edit'`,
    [runId, conversationId, FLAG_TITLE],
  );
  await notifyChanged('conversation', conversationId);
  return conversationId;
}

async function steerAfterFlag(conversationId: string): Promise<void> {
  await sql(
    `INSERT INTO member_messages
       (id, conversation_id, run_id, body, urgency, status, delivered_run_id, delivered_at,
        delivered_text_offset, created_at)
     SELECT gen_random_uuid(), $1::uuid, f.run_id, 'Also keep it short', 'now', 'delivered', f.run_id,
       f.created_at + interval '1 millisecond', 0, f.created_at + interval '1 millisecond'
     FROM rail_flags f WHERE f.conversation_id = $1::uuid`,
    [conversationId],
  );
  await notifyChanged('conversation', conversationId);
}

async function timeline(page: Page): Promise<string[]> {
  return page
    .locator('.msg.ai')
    .last()
    .evaluate((turn) =>
      [
        ...turn.querySelectorAll(
          '.trows, .flag-line, .md, .steer-item, [role="group"][aria-labelledby]',
        ),
      ].flatMap((element) => {
        if (element.classList.contains('steer-group')) return ['steer'];
        if (element.classList.contains('trows')) return ['steps'];
        if (element.classList.contains('flag-line')) return ['flag'];
        if (element.closest('.steer-item'))
          return element.classList.contains('steer-item') ? ['steer'] : [];
        if (element.classList.contains('md')) return ['reply'];
        const labelId = element.getAttribute('aria-labelledby') ?? '';
        const name = document.getElementById(labelId)?.textContent ?? '';
        if (/^Edit .+\?$/.test(name)) return ['edit card'];
        if (/^Run .+\?$/.test(name)) return ['run card'];
        return [];
      }),
    );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page
      .locator('.msg.ai')
      .last()
      .screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });
}

let repo: ChatRepo;

test.beforeEach(() => {
  repo = chatRepo();
});

test.afterEach(() => repo.remove());

test('answered cards and flags keep their place in time and a waiting card stays last', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await resetTestDatabase({ onboarded: true });
  await linkedChat(page, repo);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
  await send(page, 'Add a line to the notes #edit #approve');
  await allowEdit(page);

  const run = card(page, /^Run .+\?$/);
  await expect(run.getByRole('button', { name: /^Allow/ })).toBeVisible();
  await flagAfterEditCard();
  await expect(page.locator('.flag-line')).toContainText(FLAG_TITLE);
  await expect
    .poll(() => timeline(page))
    .toEqual(['steps', 'edit card', 'flag', 'steps', 'run card']);
  await expect(run).toBeInViewport();
  const working = page.locator('.msg.ai').last().locator('.turn-working');
  await expect(working).toHaveCount(0);
  await shot(page, 'timeline-waiting');

  await run
    .getByRole('button', { name: /^Allow/ })
    .first()
    .click();
  await turnDone(page);
  expect(await timeline(page)).toEqual([
    'steps',
    'edit card',
    'flag',
    'steps',
    'run card',
    'reply',
  ]);
  await page.reload();
  await expect(page.locator('.flag-line')).toContainText(FLAG_TITLE);
  expect(await timeline(page)).toEqual([
    'steps',
    'edit card',
    'flag',
    'steps',
    'run card',
    'reply',
  ]);
  await shot(page, 'timeline-done');
});

test('a closed fold keeps answered cards and flags outside it', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, collapseTurns: true });
  await linkedChat(page, repo);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
  await send(page, 'Add a line to the notes #edit #commentary');
  await allowEdit(page);
  await turnDone(page);
  await flagAfterEditCard();

  const turn = page.locator('.msg.ai').last();
  const fold = turn.getByRole('button', { name: /^Worked/ });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(turn.locator('.flag-line')).toBeVisible();
  await expect(card(page, /^Edit .+\?$/)).toBeVisible();

  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(turn.locator('.flag-line')).toHaveCount(1);
  await expect(card(page, /^Edit .+\?$/)).toHaveCount(1);
});

test('a steered message and a new turn leave answered cards and flags where they were', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await resetTestDatabase({ onboarded: true });
  await linkedChat(page, repo);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
  await send(page, 'Add a line to the notes #edit #approve');
  await allowEdit(page);

  const run = card(page, /^Run .+\?$/);
  await expect(run.getByRole('button', { name: /^Allow/ })).toBeVisible();
  const conversationId = await flagAfterEditCard();
  await steerAfterFlag(conversationId);
  await expect(page.locator('.steer-item')).toContainText('Also keep it short');
  const steered = ['steps', 'edit card', 'flag', 'steer', 'steps', 'run card'];
  await expect.poll(() => timeline(page)).toEqual(steered);

  await run
    .getByRole('button', { name: /^Allow/ })
    .first()
    .click();
  await turnDone(page);
  const finished = [...steered, 'reply'];
  expect(await timeline(page)).toEqual(finished);

  const oldTurn = page.locator('.msg.ai').last();
  const flagBefore = await oldTurn.locator('.flag-line').boundingBox();
  await send(page, 'One more thing');
  await expect(page.locator('.msg.ai')).toHaveCount(2);
  await turnDone(page);
  const turns = page.locator('.msg.ai');
  await expect(turns.first().locator('.flag-line')).toHaveCount(1);
  await expect(turns.first().locator('.steer-item')).toHaveCount(1);
  await expect(turns.last().locator('.flag-line')).toHaveCount(0);
  await expect(turns.last().locator('.appr')).toHaveCount(0);
  const flagAfter = await turns.first().locator('.flag-line').boundingBox();
  expect(flagAfter?.y ?? 0).toBeLessThan(flagBefore?.y ?? 0);
  const asked = page.locator('.msg.user, .msg.me').last();
  const askedBox = await asked.boundingBox();
  expect(flagAfter?.y ?? 0).toBeLessThan(askedBox?.y ?? 0);

  await page.reload();
  await expect(page.locator('.msg.ai')).toHaveCount(2);
  await expect(page.locator('.msg.ai').first().locator('.flag-line')).toHaveCount(1);
  expect(
    await page
      .locator('.msg.ai')
      .first()
      .evaluate((turn) => Boolean(turn.querySelector('.steer-item'))),
  ).toBe(true);
});
