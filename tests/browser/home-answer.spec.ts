import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats, type SeedApproval } from './sidebar-seed.ts';

const home = (page: Page) => page.locator('main.page', { has: page.locator('#home-greet') });
const needs = (page: Page) => home(page).getByRole('list', { name: 'Needs you' });

const command: SeedApproval = { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' };
const forcePush: SeedApproval = {
  kind: 'execute',
  title: 'git push --force',
  command: 'git push --force origin spark/release',
  payload: { forcePush: ['spark/release'] },
};
const question: SeedApproval = {
  kind: 'clarify',
  title: 'Which region?',
  checkpoint: { kind: 'clarify', question: 'Which region?', reason: 'Unclear.' },
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 10, 11, 0, 0));
  await resetTestDatabase({ onboarded: true });
});

test('an ordinary command card is allowed from its Home row and the run continues', async ({
  page,
}) => {
  const response = await page.request.patch('/api/providers/claude/defaults', {
    data: { agentMode: 'default' },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  const composer = home(page).getByRole('textbox', { name: 'Message' });
  await composer.fill('Run the tests #approve');
  await composer.press('Enter');

  const allow = home(page).getByRole('button', { name: /^Allow once: / });
  await expect(allow).toBeVisible({ timeout: 20_000 });
  await expect(home(page).getByRole('button', { name: /^Deny: / })).toBeVisible();
  await allow.click();
  await expect(home(page).getByRole('button', { name: /^Allow once: / })).toHaveCount(0);

  await expect
    .poll(
      async () => {
        const chats = (await (await page.request.get('/api/conversations')).json()) as {
          id: string;
          latestRun: { status: string } | null;
        }[];
        const chat = chats[0];
        if (!chat) return '';
        const detail = (await (await page.request.get(`/api/conversations/${chat.id}`)).json()) as {
          messages: { content: string }[];
        };
        return detail.messages.map((message) => message.content).join('\n');
      },
      { timeout: 20_000 },
    )
    .toContain('fake-run=allowed');
});

test('an ordinary card answered from the since-you-left lead leaves and moves focus on', async ({
  page,
}) => {
  await seedChats([
    { title: 'Ship the notes', run: { status: 'succeeded' }, unread: true },
    { title: 'Deploy the site', run: { status: 'awaiting_approval' }, approval: command },
  ]);
  await page.goto('/');
  const since = home(page).getByRole('region', { name: 'Since you left' });
  await since.getByRole('button', { name: 'Allow once: Deploy the site' }).click();
  await expect(since.getByRole('button', { name: /^Allow once/ })).toHaveCount(0);
  await expect(since.getByRole('button', { name: 'Review: Ship the notes' })).toBeFocused();
});

test('a held, instruction or question card shows no Allow or Deny, only Open chat', async ({
  page,
}) => {
  await seedChats([
    {
      title: 'Rewrite the release branch',
      run: { status: 'awaiting_approval' },
      approval: forcePush,
    },
    { title: 'Pick a region', run: { status: 'awaiting_approval' }, approval: question },
    {
      title: 'Change the rules',
      run: { status: 'awaiting_approval' },
      approval: {
        kind: 'edit',
        title: 'Edit AGENTS.md',
        paths: ['AGENTS.md'],
        payload: { instructionFiles: ['AGENTS.md'] },
      },
    },
  ]);
  await page.goto('/');
  await expect(needs(page).getByRole('button', { name: /^Answer: / })).toHaveCount(3);
  await expect(home(page).getByRole('button', { name: /^(Allow once|Deny): / })).toHaveCount(0);
});

test('a refused answer puts the row back with the reason', async ({ page }) => {
  await seedChats([
    { title: 'Deploy the site', run: { status: 'awaiting_approval' }, approval: command },
  ]);
  await page.route('**/api/approvals/*/decision', (route) =>
    route.fulfill({ status: 409, json: { error: 'This card was already answered.' } }),
  );
  await page.goto('/');
  await home(page).getByRole('button', { name: 'Allow once: Deploy the site' }).click();
  await expect(home(page).getByRole('alert')).toContainText('Could not answer');
  await expect(
    home(page).getByRole('button', { name: 'Allow once: Deploy the site' }),
  ).toBeVisible();
});
