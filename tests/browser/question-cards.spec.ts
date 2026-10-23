import { expect, test } from '@playwright/test';
import {
  card,
  chatRepo,
  type ChatRepo,
  linkedChat,
  resetWithAgents,
  send,
  turnDone,
} from './project-chat-kit.ts';

let repo: ChatRepo;

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => {
  repo.remove();
});

const asked = (page: Parameters<typeof card>[0]) => card(page, /has questions/);

test('answers an agent’s questions with keys and sends them back to the agent', async ({
  page,
}) => {
  await linkedChat(page, repo);
  await send(page, 'Set up the cache #askclaude #build');
  const questions = asked(page);
  await expect(questions).toContainText('Please answer the following questions.', {
    timeout: 30_000,
  });
  await expect(questions.getByRole('button', { name: /Let the rules decide/ })).toHaveCount(0);
  await expect(questions.getByRole('button', { name: 'Answer in your own words' })).toHaveCount(0);

  const store = questions.getByRole('radiogroup', { name: /choose one/ });
  const postgres = store.getByRole('radio', { name: /^Postgres/ });
  const redis = store.getByRole('radio', { name: /^Redis/ });
  await expect(store.locator('.ask-radio')).toHaveCount(2);
  await expect(store.locator('.ask-radio').first()).toHaveCSS('border-radius', '50%');
  await postgres.focus();
  await page.keyboard.press('2');
  await expect(redis).toBeChecked();
  await page.keyboard.press('1');
  await expect(postgres).toBeChecked();
  await expect(redis).not.toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(redis).toBeFocused();
  await expect(redis).toBeChecked();
  await expect(postgres).not.toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(postgres).toBeChecked();
  await expect(postgres).toHaveAttribute('tabindex', '0');
  await expect(redis).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('Enter');
  const lint = questions.getByRole('button', { name: /^Lint/ });
  await expect(lint).toBeFocused();
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await expect(lint).toHaveAttribute('aria-pressed', 'true');
  await expect(questions.getByRole('button', { name: /^Types/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('e2e');
  await page.keyboard.press('ControlOrMeta+Enter');

  await expect(
    page.getByText(
      'asked=accept answers={"Which store should the cache use?":"Postgres","Which checks should run before the push?":"Lint, Types, e2e"}',
    ),
  ).toBeVisible({ timeout: 30_000 });
  await turnDone(page);
  await expect(questions.getByRole('status')).toContainText('Answered.');
  await expect(questions).toContainText(
    'Which checks should run before the push? → Lint, Types — plus: e2e',
  );
});

test('Skip tells the agent the questions were skipped', async ({ page }) => {
  await linkedChat(page, repo);
  await send(page, 'Set up the cache #askclaude #build');
  const questions = asked(page);
  await questions.getByRole('button', { name: 'Skip', exact: true }).click({ timeout: 30_000 });
  await expect(page.getByText('asked=decline answers={}')).toBeVisible({ timeout: 30_000 });
  await turnDone(page);
  await expect(questions.getByRole('status')).toContainText('Skipped.');
});
