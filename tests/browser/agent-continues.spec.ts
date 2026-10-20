import { expect, test } from '@playwright/test';
import { openChats } from './navigation.ts';
import { resetWithAgents, send } from './project-chat-kit.ts';

test.describe('a chat whose agent continues on its own', () => {
  test.beforeEach(async () => {
    await resetWithAgents();
  });

  test('shows the agent’s own turn live after the reply, with no message sent', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await send(page, '#build #later');

    const turns = page.locator('section[data-turn]');
    await expect(turns.first()).toContainText("I'll check back on my own.", { timeout: 30_000 });
    await expect(turns).toHaveCount(2, { timeout: 30_000 });
    await expect(turns.nth(1)).toContainText('Continued on its own');
    await expect(turns.nth(1)).toContainText('Woke up on my own: checked.');
    await expect(page.locator('.msg.me')).toHaveCount(1);
  });
});
