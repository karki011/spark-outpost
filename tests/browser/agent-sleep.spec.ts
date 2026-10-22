import { expect, test } from '@playwright/test';
import { openChats } from './navigation.ts';
import { resetWithAgents, send } from './project-chat-kit.ts';

const SLEEPING = /^Sleeping until \d{1,2}[:.]\d{2}/;

test.describe('a chat whose agent sleeps until a wakeup', () => {
  test.beforeEach(async () => {
    await resetWithAgents();
  });

  test('says when the agent wakes, and Stop waiting ends the sleep', async ({ page }) => {
    test.setTimeout(60_000);
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await send(page, 'Check the build later #build #sleeplong');

    const turn = page.locator('.msg.ai').last();
    const line = turn.locator('.background-work [role="status"]');
    await expect(line).toHaveText(SLEEPING, { timeout: 30_000 });
    await expect(page.locator('.msg.ai .mood').last()).toHaveText(/^sleeping until /);
    await expect(turn.locator('.md').last()).toContainText('Sleeping until the build is done.');
    const sidebar = page.getByRole('navigation', { name: 'Chats' });
    await expect(sidebar.locator('.row.st-running.active')).toHaveCount(1);

    const input = page.getByRole('textbox', { name: 'Message' });
    await input.fill('Any news?');
    await expect(page.locator('.hint').first()).toHaveAttribute(
      'title',
      /^Enter to send to the agent now, while it waits on a wakeup at /,
    );
    await input.fill('');

    const stop = turn.getByRole('button', { name: 'Stop waiting' });
    await stop.focus();
    await expect(stop).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(turn.locator('.background-work')).toHaveCount(0, { timeout: 30_000 });
    await expect(turn).toContainText('Stopped before finishing.');
  });

  test('picks up in the same turn when the wakeup comes', async ({ page }) => {
    test.setTimeout(60_000);
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await send(page, 'Check the build soon #build #sleep');

    const turns = page.locator('section[data-turn]');
    await expect(turns.first()).toContainText('Awake: the build is green.', { timeout: 30_000 });
    await expect(turns).toHaveCount(1);
    await expect(page.locator('.msg.ai .background-work')).toHaveCount(0);
  });
});
