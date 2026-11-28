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
    return {
      side: Math.round(box('.docs-side').width),
      find: `${Math.round(box('.docs-find').top)}+${Math.round(box('.docs-find').height)}`,
      title: Math.round(box('.docs-article h1').left),
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
  for (const width of [1440, 700]) {
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
