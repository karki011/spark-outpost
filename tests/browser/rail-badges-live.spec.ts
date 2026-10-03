import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';
import { connectTickets, resetTicketFakes } from './ticket-seed.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
});

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test('the Tickets badge updates live when tickets sync, without opening Tickets', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(rail(page).getByLabel(/tickets? need/)).toHaveCount(0);

  await connectTickets(page);
  await page.request.get('/api/tickets/inbox');

  await expect(rail(page).getByLabel('2 tickets need attention')).toBeVisible({
    timeout: 15_000,
  });
  await expect(rail(page).getByRole('button', { name: /^Home/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('the Chats badge updates live when a chat needs approval, without opening Chats', async ({
  page,
}) => {
  await page.goto('/');
  await expect(rail(page).getByLabel(/chats? need/)).toHaveCount(0);

  await seedChats([
    {
      title: 'Run the suite',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Run tests', command: 'pnpm test' },
    },
  ]);

  await expect(rail(page).getByLabel('1 chat needs your input')).toBeVisible({
    timeout: 15_000,
  });
  await expect(rail(page).getByRole('button', { name: /^Home/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
