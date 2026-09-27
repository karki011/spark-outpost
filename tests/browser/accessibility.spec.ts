import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const THEMES = [
  'light',
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'contrast',
] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

const TEXT_SPACING_CSS = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Current chat' },
    {
      title: 'Run the suite',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Run tests', command: 'pnpm test' },
    },
    { title: 'Ship the notes', run: { status: 'succeeded' }, unread: true },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' } },
  ]);
});

async function openWorkedChat(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.taskc')).toContainText('7 of 7 done', { timeout: 20_000 });
}

async function useTheme(page: Page, theme: string) {
  await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
  await page.evaluate(() => document.fonts.ready);
}

function isBlocking(violation: { id: string; impact?: string | null }): boolean {
  const colourOrAria = violation.id === 'color-contrast' || violation.id.startsWith('aria-');
  return colourOrAria && BLOCKING_IMPACTS.has(violation.impact ?? '');
}

async function settle(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
}

async function blockingViolations(page: Page, screen: string) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.filter(isBlocking).map((violation) => ({
    screen,
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

for (const theme of THEMES) {
  test(`${theme} theme has no serious colour-contrast or ARIA issues on the main screens`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWorkedChat(page);
    await useTheme(page, theme);
    const found = await blockingViolations(page, 'chat with work panel');

    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Profile' });
    await expect(settings).toBeVisible();
    found.push(...(await blockingViolations(page, 'settings profile')));
    await settings.getByRole('tab', { name: 'Appearance' }).click();
    await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible();
    found.push(...(await blockingViolations(page, 'settings appearance')));
    await page
      .getByRole('dialog', { name: 'Appearance' })
      .getByRole('tab', { name: 'Models' })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Models' }).getByRole('switch').first(),
    ).toBeVisible();
    found.push(...(await blockingViolations(page, 'settings models')));

    expect(found).toEqual([]);
  });
}

test('interactive targets on the chat screen are at least 24 by 24 pixels', async ({ page }) => {
  await openWorkedChat(page);
  const small = await page.evaluate(() => {
    const selector =
      'button, a[href], [role="button"], [role="tab"], [role="menuitem"], input[type="checkbox"], input[type="radio"], summary';
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.checkVisibility({ visibilityProperty: true }))
      .filter((element) => getComputedStyle(element).display !== 'inline')
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && (box.width < 23.5 || box.height < 23.5))
      .map(({ element, box }) => {
        const name = element.getAttribute('aria-label') ?? element.textContent ?? '';
        return `${Math.round(box.width)}x${Math.round(box.height)} ${name.trim().slice(0, 40)}`;
      });
  });
  expect(small).toEqual([]);
});

test('text spacing overrides do not clip button or tab labels', async ({ page }) => {
  await openWorkedChat(page);
  await page.addStyleTag({ content: TEXT_SPACING_CSS });
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, [role="tab"]')]
      .filter((element) => element.checkVisibility({ visibilityProperty: true }))
      .filter((element) => getComputedStyle(element).overflowY !== 'visible')
      .filter((element) => element.scrollHeight > element.clientHeight + 1)
      .map((element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim()),
  );
  expect(clipped).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
});

test('the chat screen reflows at 200% zoom without horizontal scrolling', async ({ page }) => {
  await openWorkedChat(page);
  await page.setViewportSize({ width: 640, height: 450 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeInViewport();
  await input.fill('Still reachable');
  await expect(page.getByRole('button', { name: /^Send/ })).toBeInViewport();
});
