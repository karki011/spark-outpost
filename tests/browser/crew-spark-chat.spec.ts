import { expect, test, type Page } from '@playwright/test';
import { addSpark, openSparksPage } from './crew-files-kit.ts';
import { resetWithAgents } from './project-chat-kit.ts';

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async () => {
  await resetWithAgents();
});

const dock = (page: Page) => page.getByRole('complementary', { name: 'Chat about Scribe' });

async function openScribe(page: Page): Promise<string> {
  const id = await addSpark(page, {
    name: 'Scribe',
    role: 'Release notes writer',
    instructions: 'Write release notes.',
  });
  await openSparksPage(page);
  await page
    .getByRole('button', { name: /Scribe/ })
    .first()
    .click();
  await page.getByRole('tab', { name: /Skills and files/ }).click();
  return id;
}

test('a Spark has its own agent chat in the right sidebar', async ({ page }) => {
  const id = await openScribe(page);
  const ask = page.getByRole('button', { name: 'Ask an agent' });
  await ask.click();
  await expect(ask).toHaveAttribute('aria-pressed', 'true');
  await expect(dock(page)).toContainText('edit Scribe’s instructions');
  const input = dock(page).getByRole('textbox', { name: 'Message' });
  await input.fill('Add a changelog skill');
  await input.press('Enter');
  await expect(dock(page).getByText(/You wrote: "Add a changelog skill"/)).toBeVisible({
    timeout: 30_000,
  });
  const chat = (await (await page.request.get(`/api/crew/builder?spark=${id}`)).json()) as {
    chat: { sparkId: string } | null;
  };
  expect(chat.chat?.sparkId).toBe(id);
  const crew = (await (await page.request.get('/api/crew/builder')).json()) as {
    chat: unknown;
  };
  expect(crew.chat).toBeNull();

  await dock(page).getByRole('button', { name: 'Close the chat about Scribe' }).click();
  await expect(dock(page)).toHaveCount(0);
  await expect(ask).toHaveAttribute('aria-pressed', 'false');
});

test('the folder follows changes while the chat is open', async ({ page }) => {
  const id = await openScribe(page);
  await page.getByRole('button', { name: 'Ask an agent' }).click();
  await expect(dock(page)).toBeVisible();
  const saved = await page.request.put(`/api/teammates/${id}/files`, {
    data: { path: 'notes/style.md', text: 'Plain words.\n', baseHash: null },
  });
  expect(saved.ok()).toBe(true);
  await expect(page.getByRole('treeitem', { name: /style\.md/ })).toBeVisible({ timeout: 10_000 });
});
