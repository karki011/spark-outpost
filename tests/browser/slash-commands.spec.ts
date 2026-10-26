import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const AGENT_COMMANDS = {
  provider: 'claude',
  commands: [
    { name: 'compact', description: 'Summarize the conversation so far', hint: null },
    { name: 'logout', description: 'Sign out', hint: null },
    { name: 'review-branch', description: 'Review changes against a branch', hint: 'branch' },
    { name: 'status', description: '', hint: null },
  ],
};

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function chatWithHistory(page: Page) {
  await page.route('**/api/conversations/*/agent-commands', (route) =>
    route.fulfill({ json: AGENT_COMMANDS }),
  );
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Hello there');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 20_000 });
  return input;
}

test("the / menu lists our commands and the agent's, filters and inserts by keyboard", async ({
  page,
}) => {
  const input = await chatWithHistory(page);
  await input.fill('/');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option')).toHaveText([
    /\/fresh/,
    /\/model/,
    /\/effort/,
    /\/plan/,
    /\/review/,
    /\/mcp/,
    /\/compact/,
    /\/review-branch/,
    /\/status/,
  ]);
  await expect(menu.getByRole('option', { name: /\/fresh/ })).toContainText('Spark');
  await expect(menu.getByRole('option', { name: /\/status/ })).toContainText(
    'No description from Claude',
  );
  await expect(menu.getByRole('option', { name: /\/compact/ })).toContainText('Claude');
  const detail = page.locator('.slash-detail');
  await expect(detail).toHaveText(
    'The next message opens a new Claude session and resends the chat history.',
  );
  await expect(menu.getByRole('option', { name: /logout/ })).toHaveCount(0);
  await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');

  const results = await new AxeBuilder({ page })
    .include('.slashpop')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await input.pressSequentially('comp');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await input.press('Enter');
  await expect(input).toHaveValue('/compact ');
  await expect(menu).toBeHidden();

  await input.fill('/re');
  await expect(menu).toBeVisible();
  await input.press('ArrowDown');
  await expect(menu.getByRole('option', { name: /review-branch/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(detail).toHaveText(
    "Usage: /review-branch <branch>. Runs in Claude's session, and only when this chat continues it.",
  );
  await input.press('Escape');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('/re');
});

test('typed harness-owned commands are blocked and /model opens the picker', async ({ page }) => {
  const input = await chatWithHistory(page);
  let sent = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/messages')) sent += 1;
  });

  await input.fill('/logout');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await expect(menu.getByRole('option')).toHaveCount(0);
  const blocked = '/logout is blocked: sign-in is managed in Settings.';
  await expect(page.locator('.slashpop').getByRole('status')).toHaveText(blocked);

  await input.fill('/logout now');
  await input.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: blocked }).first()).toBeVisible();
  await expect(input).toHaveValue('/logout now');
  expect(sent).toBe(0);

  await input.fill('/deploy now');
  await expect(
    page.getByRole('status').filter({ hasText: "/deploy isn't a Spark or Claude command" }),
  ).toBeVisible();

  await input.fill('/mod');
  await input.press('Enter');
  await expect(input).toHaveValue('/model ');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('dialog', { name: 'Model, effort, and permissions' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Model/ })).toBeFocused();
  expect(sent).toBe(0);
});

test('the / menu opens again after dismissing it and sending', async ({ page }) => {
  const input = await chatWithHistory(page);
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await input.fill('/compact');
  await expect(menu).toBeVisible();
  await input.press('Escape');
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(input).toHaveValue('');
  await input.focus();
  await page.keyboard.insertText('/');
  await expect(menu).toBeVisible();
});

test('/effort with a value applies it once without render-phase updates', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const input = await chatWithHistory(page);
  let patches = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith('/settings')) patches += 1;
  });
  await input.fill('/effort high');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Effort set to' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Model and effort/ })).toBeVisible();
  expect(patches).toBe(1);
  expect(errors.filter((text) => text.includes('while rendering a different component'))).toEqual(
    [],
  );
});
