import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const docs = (page: Page) => page.getByRole('main', { name: 'Docs' });
const article = (page: Page) => docs(page).getByRole('article');
const PAGES = ['welcome', 'sub-chats', 'answer-approvals', 'glossary', 'connect-cloudflare'];

async function open(page: Page, slug: string) {
  await page.evaluate((target) => (window.location.hash = `#/docs/${target}`), slug);
  await expect(article(page)).toHaveAttribute('data-page', slug);
}

function frame(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const origin = box('.page.docs');
    const half = (value: number) => Math.round(value * 2) / 2;
    return {
      side: half(box('.docs-side').width),
      find: `${half(box('.docs-find').top - origin.top)}+${half(box('.docs-find').height)}`,
      title: half(box('.docs-article h1').left - origin.left),
    };
  });
}

for (const width of [1100, 1440, 1720]) {
  test(`the sidebar and the title stay in place from page to page at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/docs/welcome');
    await expect(article(page)).toHaveAttribute('data-page', 'welcome');
    const first = await frame(page);
    expect(first.side).toBe(264);
    for (const slug of PAGES) {
      await open(page, slug);
      expect(await frame(page), slug).toEqual(first);
    }
  });
}

test('every sidebar row is one line, with nothing cut off', async ({ page }) => {
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/docs/welcome');
    const nav = docs(page).getByRole('navigation', { name: 'Guide pages' });
    await nav.evaluate((list) => {
      for (const closed of list.querySelectorAll<HTMLElement>('button[aria-expanded="false"]')) {
        closed.click();
      }
    });
    await expect(nav.locator('button[aria-expanded="false"]')).toHaveCount(0);
    const rows = await nav.evaluate((list) =>
      [...list.querySelectorAll<HTMLElement>('a, h2 button')].map((row) => {
        const name = row.querySelector<HTMLElement>('.docs-nav-name')!;
        return {
          text: name.textContent,
          height: Math.round(row.getBoundingClientRect().height),
          cut: name.scrollWidth > name.clientWidth,
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(80);
    expect(
      rows.filter((row) => row.height !== 30 || row.cut),
      `${width}px`,
    ).toEqual([]);
  }
});

test('prose keeps a readable line and the outline sits in its own column', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/docs/answer-approvals');
  const paragraph = article(page).locator('.docs-body > p').first();
  expect((await paragraph.boundingBox())!.width).toBeLessThanOrEqual(640);
  const body = (await article(page).locator('.docs-body').boundingBox())!;
  const outline = (await docs(page)
    .getByRole('navigation', { name: 'On this page' })
    .boundingBox())!;
  expect(outline.x).toBeGreaterThanOrEqual(body.x + body.width);
});

test('Back returns to where you were reading', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/docs/cards');
  await expect(article(page)).toHaveAttribute('data-page', 'cards');
  const scroller = page.locator('.docs-main');
  await scroller.evaluate((element) => element.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => window.history.state?.docsScroll?.top)).toBe(700);
  await open(page, 'glossary');
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await page.goBack();
  await expect(article(page)).toHaveAttribute('data-page', 'cards');
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(700);
  await page.goForward();
  await expect(article(page)).toHaveAttribute('data-page', 'glossary');
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
});

test('the open page stays in view in the sidebar and the list does not jump', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.goto('/#/docs/start-a-chat');
  await expect(article(page)).toHaveAttribute('data-page', 'start-a-chat');
  const nav = docs(page).getByRole('navigation', { name: 'Guide pages' });
  const projects = nav.getByRole('button', { name: /^Projects and shipping/ });
  await open(page, 'sub-chat-reports');
  await expect(nav.getByRole('link', { name: 'Reports and the wrap-up' })).toBeInViewport({
    ratio: 1,
  });
  const scrolled = await nav.evaluate((list) => list.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  await open(page, 'sub-chats');
  expect(await nav.evaluate((list) => list.scrollTop)).toBe(scrolled);

  await nav.evaluate((list) => list.scrollTo(0, 0));
  const offset = () =>
    projects.evaluate((button) =>
      Math.round(
        (button.getBoundingClientRect().top - button.closest('nav')!.getBoundingClientRect().top) *
          2,
      ),
    );
  const before = await offset();
  await open(page, 'glossary');
  await expect(nav.getByRole('link', { name: 'Glossary' })).toBeInViewport({ ratio: 1 });
  await nav.evaluate((list) => list.scrollTo(0, 0));
  expect(await offset()).toBe(before);

  const search = docs(page).getByRole('searchbox', { name: 'Search the guide' });
  await nav.evaluate((list) => list.scrollTo(0, 300));
  await search.fill('autonomy');
  await expect(docs(page).getByRole('list', { name: 'Search results' })).toBeVisible();
  await search.fill('');
  await expect.poll(() => nav.evaluate((list) => list.scrollTop)).toBe(300);
});

test('the keyboard skips the contents, walks search results and the outline marks the section', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/docs/answer-approvals');
  await expect(article(page)).toHaveAttribute('data-page', 'answer-approvals');
  await expect(page.getByRole('complementary', { name: 'Guide contents' })).toBeVisible();
  const skip = docs(page).getByRole('link', { name: 'Skip to the page' });
  await skip.focus();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(docs(page).getByRole('heading', { level: 1 })).toBeFocused();

  const search = docs(page).getByRole('searchbox', { name: 'Search the guide' });
  await search.fill('autonomy');
  const results = docs(page).getByRole('list', { name: 'Search results' }).getByRole('link');
  await search.press('ArrowDown');
  await expect(results.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(results.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(search).toBeFocused();
  await search.fill('');

  const outline = docs(page).getByRole('navigation', { name: 'On this page' });
  await outline.getByRole('link', { name: 'Hold to confirm' }).click();
  await expect(outline.getByRole('link', { name: 'Hold to confirm' })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await expect(outline.locator('[aria-current]')).toHaveCount(1);
});
