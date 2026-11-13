import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openSparksPage } from './crew-files-kit.ts';
import { resetWithAgents } from './project-chat-kit.ts';
import { animationsSettled } from './settle.ts';

const SHOTS = 'test-results/crew-builder';

test.describe.configure({ timeout: 90_000 });

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  await resetWithAgents();
});

const dock = (page: Page) => page.getByRole('complementary', { name: 'Builder chat' });
const doneLine = (page: Page) => dock(page).locator('.bld-done');
const listedChats = async (page: Page) =>
  (await (await page.request.get('/api/conversations')).json()) as { id: string }[];

async function shots(page: Page, name: string) {
  await page.mouse.move(0, 0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await animationsSettled(page);
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

test('the builder chat docks beside the Sparks page, talks to the agent and is marked Done', async ({
  page,
}) => {
  await openSparksPage(page);
  await page.getByRole('button', { name: 'Build with an agent' }).click();
  await expect(dock(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Sparks', exact: true })).toBeVisible();
  const input = dock(page).getByRole('textbox', { name: 'Message' });
  await input.fill('Make a Spark that reviews release notes');
  await input.press('Enter');
  await expect(
    dock(page).getByText(/You wrote: "Make a Spark that reviews release notes"/),
  ).toBeVisible({
    timeout: 30_000,
  });
  const chat = (await (await page.request.get('/api/crew/builder')).json()) as {
    chat: { conversationId: string };
  };
  expect((await listedChats(page)).map((listed) => listed.id)).not.toContain(
    chat.chat.conversationId,
  );
  await shots(page, 'builder-open');

  await dock(page).getByRole('button', { name: 'Done' }).click();
  await expect(doneLine(page)).toContainText('Done · removed tomorrow at');
  await expect(dock(page).getByRole('button', { name: 'New chat' })).toBeVisible();
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.bld-dock')
    .analyze();
  expect(scan.violations).toEqual([]);
  await shots(page, 'builder-done');

  await dock(page).getByRole('button', { name: 'Close builder chat' }).click();
  await expect(dock(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Build with an agent' }).click();
  await expect(doneLine(page)).toContainText('Done · removed tomorrow at');
});

test('a draft waiting for you shows on the page and opens the builder chat', async ({ page }) => {
  await page.route('**/api/crew/drafts', (route) =>
    route.fulfill({
      json: {
        drafts: [
          {
            approvalId: '0198c0de-0000-7000-8000-000000000001',
            conversationId: '0198c0de-0000-7000-8000-000000000002',
            target: 'spark',
            name: 'Release notes',
            inBuilder: true,
          },
        ],
      },
    }),
  );
  await openSparksPage(page);
  const draft = page.getByRole('listitem').filter({ hasText: 'Release notes' });
  await expect(draft).toContainText('Spark · Draft · waiting for you');
  await draft.getByRole('button', { name: 'Review Release notes' }).click();
  await expect(dock(page)).toBeVisible();
  await shots(page, 'builder-draft');
});

test('the corner companion opens the builder chat', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await page.getByRole('button', { name: /^Status: / }).click();
  await page
    .getByRole('dialog', { name: 'Status' })
    .getByRole('button', { name: 'Build a Spark or workflow' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sparks', exact: true })).toBeVisible();
  await expect(dock(page)).toBeVisible();
});
