import { expect, test } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { emitVoice, installFakeVoice } from './fake-voice.ts';
import { startFixtureTerminal } from './native-terminal-fixture.ts';

async function sentMessages() {
  const db = openTestDb();
  try {
    const result = await db.query(`SELECT count(*)::int AS n FROM messages WHERE role = 'user'`);
    return result.rows[0].n as number;
  } finally {
    await db.end();
  }
}

for (const [tab, label] of [
  ['New chat', 'Message'],
  ['Ask Spark', 'Ask Spark'],
] as const) {
  test(`${tab} restores keyboard focus after stopping dictation`, async ({ page }) => {
    await resetTestDatabase({ onboarded: true });
    await installFakeVoice(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/island');
    const island = page.getByRole('region', { name: 'Spark Island' });
    await island.getByRole('button', { name: 'Open Spark Island' }).click();
    await island.getByRole('button', { name: tab, exact: true }).click();
    const input = island.getByRole('textbox', { name: label, exact: true });
    await input.fill('Please');
    await island.getByRole('button', { name: 'Dictate', exact: true }).click();
    await island.getByRole('button', { name: 'Stop dictating' }).click();
    await emitVoice(page, {
      kind: 'final',
      id: 'listen-1',
      text: 'inspect this change',
      reason: 'stopped',
    });
    await expect(input).toHaveValue('Please inspect this change');
    await expect(input).toBeFocused();
    await expect(island.getByRole('button', { name: 'Dictate', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await sentMessages()).toBe(0);
    await page.keyboard.press('Enter');
    await expect.poll(sentMessages).toBe(1);
    await expect(island.getByRole('button', { name: 'Stop dictating' })).toHaveCount(0);
  });
}

test('Terminal dictation restores focus and Enter submits through the real form', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await installFakeVoice(page);
  const terminal = await startFixtureTerminal(page);
  const messages: unknown[] = [];
  await page.route('**/api/conversations/*/terminal/message', async (route) => {
    messages.push(route.request().postDataJSON());
    await route.fulfill({ json: null });
  });
  await terminal.getByRole('button', { name: 'Dictate', exact: true }).click();
  await terminal.getByRole('button', { name: 'Stop dictating' }).click();
  await emitVoice(page, {
    kind: 'final',
    id: 'listen-1',
    text: 'Inspect this change',
    reason: 'stopped',
  });
  const input = terminal.getByRole('textbox', { name: 'Dictated message for Codex' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Inspect this change');
  expect(messages).toHaveLength(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => messages).toEqual([{ text: 'Inspect this change' }]);
  await expect(terminal.getByRole('form', { name: 'Dictated message' })).toHaveCount(0);
});
