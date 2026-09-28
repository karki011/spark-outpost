import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const PLAN = 'Deploy plan: build the image, then run the migration first, then roll out.';

async function chatWithReply(page: Page): Promise<Locator> {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(PLAN);
  await input.press('Enter');
  const reply = page.locator('.md', { hasText: 'You wrote:' }).first();
  await expect(reply).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible();
  return reply;
}

async function selectText(
  target: Locator,
  needle: string,
  endTarget?: Locator,
  endNeedle?: string,
) {
  const start = await target.elementHandle();
  const end = endTarget ? await endTarget.elementHandle() : start;
  await target.page().evaluate(
    ([startElement, endElement, first, last]) => {
      const find = (element: Element, text: string) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.nodeValue?.indexOf(text) ?? -1;
          if (at >= 0) return { node, at };
        }
        throw new Error(`Text not found: ${text}`);
      };
      const from = find(startElement!, first);
      const to = find(endElement!, last);
      window.getSelection()!.setBaseAndExtent(from.node, from.at, to.node, to.at + last.length);
    },
    [start, end, needle, endNeedle ?? needle] as const,
  );
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selected text' });
const quoteChips = (page: Page) => page.getByRole('group', { name: 'Quotes' });
const highlightCount = (page: Page, name: string) =>
  page.evaluate((highlight) => CSS.highlights.get(highlight)?.size ?? 0, name);

test('adds quotes and a comment from a reply, then sends them as quotes', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const reply = await chatWithReply(page);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.blur();

  await selectText(reply, 'build the image');
  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).getByRole('button', { name: 'Copy' }).click();
  await expect(toolbar(page).getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('build the image');

  await toolbar(page).getByRole('button', { name: 'Add to chat' }).click();
  await expect(toolbar(page)).toBeHidden();
  await expect(quoteChips(page).getByRole('button', { name: /^build the image/ })).toBeVisible();
  await expect(input).not.toBeFocused();

  await selectText(reply, 'run the migration first');
  await toolbar(page).getByRole('button', { name: 'Comment' }).click();
  const note = toolbar(page).getByRole('textbox', { name: 'Comment on the selected text' });
  await expect(note).toBeFocused();
  await note.fill('Why before the rollout?');
  await note.press('Enter');
  await expect(toolbar(page)).toBeHidden();
  await expect(
    quoteChips(page).getByRole('button', {
      name: /^run the migration first.*Why before the rollout\?/,
    }),
  ).toBeVisible();
  await expect.poll(() => highlightCount(page, 'spark-quote-note')).toBe(1);

  const chip = quoteChips(page).getByRole('button', { name: /^build the image/ });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');

  const send = page.getByRole('button', { name: 'Send 2 comments' });
  await expect(send).toBeEnabled();
  await input.focus();
  await input.press('Enter');

  const sent = page.locator('.msg.me .bubble').nth(1);
  await expect(sent.locator('.msg-quote-lead')).toHaveText('Comments on your previous reply:');
  await expect(sent.locator('blockquote.msg-quote')).toHaveText([
    'build the image',
    'run the migration first',
  ]);
  await expect(sent).toContainText('Why before the rollout?');
  await expect(quoteChips(page)).toHaveCount(0);
  await expect(
    page.locator('.md', { hasText: 'You wrote: "Comments on your previous reply:' }),
  ).toBeVisible({ timeout: 15_000 });

  await expect.poll(() => highlightCount(page, 'spark-quote-note')).toBe(0);
  await expect.poll(() => highlightCount(page, 'spark-annotation')).toBe(1);

  await page.reload();
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByText(/^Deploy plan/)
    .click();
  await expect.poll(() => highlightCount(page, 'spark-annotation')).toBe(1);
  const mark = await page.evaluate(() => {
    const [range] = Array.from(CSS.highlights.get('spark-annotation')!) as Range[];
    range!.startContainer.parentElement!.scrollIntoView({ block: 'center' });
    const rect = range!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.mouse.move(mark.x, mark.y);
  await expect(page.getByRole('tooltip')).toContainText('Why before the rollout?');
  await page.mouse.click(mark.x, mark.y);
  await expect(page.locator('.msg.me .bubble', { hasText: 'Why before' })).toBeInViewport();
});

test('Esc closes the toolbar, Ask focuses the composer, and unsent chips survive a reload', async ({
  page,
}) => {
  const reply = await chatWithReply(page);
  const input = page.getByRole('textbox', { name: 'Message' });

  await selectText(reply, 'roll out');
  await expect(toolbar(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toolbar(page)).toBeHidden();

  await selectText(reply, 'build the image');
  await toolbar(page).getByRole('button', { name: 'Ask about this' }).click();
  await expect(input).toBeFocused();
  await expect(quoteChips(page).getByRole('button', { name: /^build the image/ })).toBeVisible();

  await selectText(reply, 'then roll out');
  await toolbar(page).getByRole('button', { name: 'Comment' }).click();
  await toolbar(page)
    .getByRole('textbox', { name: 'Comment on the selected text' })
    .fill('Staged?');
  await page.keyboard.press('Escape');
  await expect(toolbar(page)).toBeHidden();
  await expect(quoteChips(page).locator('.quote-chip')).toHaveCount(1);

  await selectText(reply, 'then roll out');
  await toolbar(page).getByRole('button', { name: 'Comment' }).click();
  await toolbar(page)
    .getByRole('textbox', { name: 'Comment on the selected text' })
    .fill('Staged?');
  await toolbar(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Send 2 comments' })).toBeVisible();

  await page.reload();
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByText(/^Deploy plan/)
    .click();
  await expect(quoteChips(page).getByRole('button', { name: /^build the image/ })).toBeVisible();
  await expect(
    quoteChips(page).getByRole('button', { name: /^then roll out.*Staged\?/ }),
  ).toBeVisible();
  await expect.poll(() => highlightCount(page, 'spark-quote-note')).toBe(1);

  await quoteChips(page)
    .getByRole('button', { name: /Remove quote: build the image/ })
    .click();
  await expect(page.getByRole('button', { name: 'Send 1 comment' })).toBeVisible();
});

test('the shortcut adds a selection and a selection across messages stays in one', async ({
  page,
}) => {
  const reply = await chatWithReply(page);
  const question = page.locator('.msg.me .bubble').first();

  await selectText(question, 'build the image', reply, 'You wrote');
  await expect(toolbar(page)).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(
    'build the image, then run the migration first, then roll out.',
  );

  await page.keyboard.press('ControlOrMeta+Shift+KeyA');
  await expect(toolbar(page)).toBeHidden();
  await expect(
    quoteChips(page).getByRole('button', { name: /^build the image, then run the migration/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send 1 quote' })).toBeVisible();

  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('What changes if we skip it?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const sent = page.locator('.msg.me .bubble').nth(1);
  await expect(sent.locator('.msg-quote-lead')).toHaveText('Comments on earlier messages:');
  await expect(sent.locator('blockquote.msg-quote')).toHaveText(
    'build the image, then run the migration first, then roll out.',
  );
  await expect(sent.locator('.msg-quote-text')).toHaveText('What changes if we skip it?');
});
