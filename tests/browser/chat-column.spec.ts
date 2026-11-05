import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { useSystemTheme } from './docs-seed.ts';
import {
  COLUMN,
  columnEdges,
  header,
  longChat,
  pageScroll,
  rail,
  widenSecondReply,
  workPanel,
} from './chat-rail-kit.ts';

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, catalog: true });
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light' });
});

test('replies fill one centred column the bubble and composer share', async ({ page }) => {
  test.setTimeout(120_000);
  await longChat(page);
  await widenSecondReply(page);
  const sharesEdges = async () => {
    const edges = await columnEdges(page);
    const { column } = edges;
    expect(Math.abs(edges.bubbleRight - column.right)).toBeLessThan(1);
    for (const part of [edges.composer, edges.prose, edges.table]) {
      expect(Math.abs(part.left - column.left)).toBeLessThan(1);
      expect(Math.abs(part.right - column.right)).toBeLessThan(1);
    }
    expect(Math.abs(edges.meta.right - column.right)).toBeLessThan(1);
    expect(await pageScroll(page)).toBe(0);
    return edges;
  };

  for (const width of [1920, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(rail(page)).toBeVisible();
    const { column, thread } = await sharesEdges();
    const columnWidth = column.right - column.left;
    expect(columnWidth).toBeLessThanOrEqual(COLUMN + 1);
    if (width === 1920) expect(columnWidth).toBeGreaterThan(COLUMN - 1);
    const railBox = (await rail(page).boundingBox())!;
    const stripLeft = thread.right - railBox.width - 32;
    expect(Math.abs(column.left - thread.left - (stripLeft - column.right))).toBeLessThan(2);
  }

  await page.setViewportSize({ width: 1920, height: 900 });
  await rail(page).getByRole('button', { name: 'Hide context rail' }).click();
  await expect(rail(page)).toHaveCount(0);
  for (const width of [1920, 1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const { column, thread } = await sharesEdges();
    expect(Math.abs(column.left + column.right - thread.left - thread.right)).toBeLessThan(2);
    expect(column.right - column.left).toBeLessThanOrEqual(COLUMN + 1);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await header(page).getByRole('button', { name: 'Show work panel' }).click();
  await expect(workPanel(page)).toBeVisible();
  await expect
    .poll(async () => {
      const [thread, panel] = await Promise.all([
        page.locator('.thread').boundingBox(),
        workPanel(page).boundingBox(),
      ]);
      return thread!.x + thread!.width - panel!.x;
    })
    .toBeLessThanOrEqual(1);
  await sharesEdges();

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(workPanel(page)).toBeHidden();
  const phone = await columnEdges(page);
  for (const part of [phone.prose, phone.table]) {
    expect(Math.abs(part.left - phone.column.left)).toBeLessThan(1);
  }
  expect(await pageScroll(page)).toBe(0);
});

test('a short label in a wide reply table stays on one line', async ({ page }) => {
  test.setTimeout(120_000);
  await longChat(page);
  await widenSecondReply(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const heights = await page
    .locator('.md table')
    .first()
    .evaluate((table) => {
      const long =
        'Owner, or anyone if visibility is org, or anyone shared. Everyone else gets 404, so a private record does not leak. ';
      table.innerHTML = `<thead><tr><th></th><th>Current</th><th>Proposed</th></tr></thead><tbody>${[
        'Create',
        'Update',
        'Delete',
      ]
        .map(
          (label) =>
            `<tr><td>${label}</td><td>Any org member can do this today</td><td>${long.repeat(3)}</td></tr>`,
        )
        .join('')}</tbody>`;
      return [...table.querySelectorAll('tbody tr')].map((row) => {
        const text = document.createRange();
        text.selectNodeContents(row.querySelector('td')!);
        return text.getClientRects().length;
      });
    });
  for (const lines of heights) expect(lines).toBe(1);
});

test('jump to latest sits under the centre of the chat column', async ({ page }) => {
  test.setTimeout(120_000);
  await longChat(page);
  const jump = page.getByRole('button', { name: 'Jump to latest' });
  const centred = async () => {
    await page.locator('.thread').hover();
    await page.mouse.wheel(0, -2000);
    await expect(jump).toBeVisible();
    await expect
      .poll(async () => {
        const [button, column] = await Promise.all([
          jump.boundingBox(),
          page.locator('.col').last().boundingBox(),
        ]);
        return Math.abs(button!.x + button!.width / 2 - (column!.x + column!.width / 2));
      })
      .toBeLessThan(2);
  };

  for (const width of [1920, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(rail(page)).toBeVisible();
    await centred();
  }
  await rail(page).getByRole('button', { name: 'Hide context rail' }).click();
  await expect(rail(page)).toHaveCount(0);
  await centred();
});
