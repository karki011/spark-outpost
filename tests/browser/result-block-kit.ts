import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { TestRepo } from '../../apps/server/test/ship-support.ts';
import { type Level, pickPermission } from './permissions-kit.ts';
import { openTestDb } from './database.ts';
import { openChats } from './navigation.ts';
import { turnDone } from './project-chat-kit.ts';

export const SHOTS = process.env.SPARK_SHOTS ?? '';

export async function chatIn(page: Page, repo: TestRepo, level: Level): Promise<void> {
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(repo.root)}`) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, level);
  await page.keyboard.press('Escape');
}

export async function buildNotes(page: Page): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Add a line to the notes #edit #plan');
  await input.press('Enter');
  await turnDone(page, 30_000);
}

export async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const SIZES = { desktop: { width: 1400, height: 900 }, phone: { width: 375, height: 812 } };

export async function shootEverywhere(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const block = page.locator('section.result').last();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((skin) => {
      document.documentElement.dataset.skin = skin === 'light' ? 'light' : 'graphite';
    }, scheme);
    for (const [size, viewport] of Object.entries(SIZES)) {
      await page.setViewportSize(viewport);
      await block.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await shoot(page, `${name}-${scheme}-${size}`);
    }
  }
}

export async function timeOutLastTurn(asked: string): Promise<void> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ id: string }>(
      `UPDATE runs SET status = 'failed', error = 'Approval timed out', finished_at = now()
        WHERE parent_run_id IS NULL
        RETURNING id`,
    );
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash,
         options, status, decision_option_id, scope, decided_by, decided_at)
       VALUES (gen_random_uuid(), $1, 'timed-out', 'execute', $2, $3, 'hash', '[]', 'expired',
         NULL, 'once', 'timeout', now())`,
      [
        rows[0]!.id,
        asked,
        JSON.stringify({
          command: 'git commit -m notes',
          cwd: null,
          paths: [],
          diffs: [],
          truncated: false,
        }),
      ],
    );
  } finally {
    await db.end();
  }
}
