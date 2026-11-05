import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { CLICK_LIMIT_MS, keyFeedbackMs } from './perf-probe.ts';

const SEND_URL = /\/api\/conversations\/[^/]+\/messages$/;
const MESSAGE = [
  '**Ship blocker:** the Export button ignores _row-level_ access.  ',
  'Second  line   keeps its spaces.',
  '',
  '- check `canExportAll()` first',
  '- add a test for ~~admins~~ team leads',
  '',
  '> from the CP-49259 review',
  '',
  '```ts',
  'expect(canExportAll(member)).toBe(false);',
  '```',
  '',
  'See [the ticket](https://acme.example/browse/CP-49259)',
].join('\n');

test.beforeEach(async () => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
});

async function newChat(page: Page): Promise<Locator> {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();
  return input;
}

function sentBodies(page: Page): string[] {
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && SEND_URL.test(request.url())) {
      bodies.push((request.postDataJSON() as { content: string }).content);
    }
  });
  return bodies;
}

const mirror = (page: Page) => page.locator('.composer .mdf-mirror');

test('a long draft stays responsive and formatting remains available from the quiet footer', async ({
  page,
}, info) => {
  const input = await newChat(page);
  const draft = Array.from(
    { length: 800 },
    (_, index) =>
      `Line ${index}: inspect **the existing code** and preserve the current selection.`,
  ).join('\n');
  await input.fill(draft);
  await input.press('ControlOrMeta+End');
  const feedback = [];
  for (let index = 0; index < 12; index += 1) feedback.push(await keyFeedbackMs(page, 'x'));
  await expect(input).toHaveValue(`${draft}${'x'.repeat(12)}`);
  await expect(input).toBeFocused();
  expect(Math.max(...feedback)).toBeLessThan(process.env.CI ? CLICK_LIMIT_MS * 5 : CLICK_LIMIT_MS);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Add files and context' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Formatting' }).click();
  await expect(input).toBeFocused();
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await input.press('Shift+ArrowLeft');
  await input.press('ControlOrMeta+b');
  await expect(input).toHaveValue(`${draft}${'x'.repeat(11)}**x**`);
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
  await info.attach('long-draft-key-feedback', {
    body: JSON.stringify({ characters: draft.length, keyFeedbackMs: feedback }),
    contentType: 'application/json',
  });
});

async function selectBack(input: Locator, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await input.press('Shift+ArrowLeft');
}

test('styles Markdown as it is typed and keeps the caret where the text is', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const input = await newChat(page);
  await input.pressSequentially('A **bold** and _slanted_ word with `code` and ~~gone~~ ');
  await expect(input).toHaveValue('A **bold** and _slanted_ word with `code` and ~~gone~~ ');
  await expect(mirror(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(mirror(page).locator('.mdm-strong')).toHaveText('bold');
  await expect(mirror(page).locator('.mdm-em')).toHaveText('slanted');
  await expect(mirror(page).locator('.mdm-code')).toHaveText('code');
  await expect(mirror(page).locator('.mdm-strike')).toHaveText('gone');
  await expect(mirror(page).locator('.mdm-marker').first()).toHaveText('**');

  const long = `${'Long **bold** words _here_ and `there` '.repeat(40)}end`;
  await input.fill(long);
  await expect(mirror(page)).toHaveText(long);
  const drift = await page.evaluate(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.composer textarea')!;
    const styled = document.querySelector<HTMLElement>('.composer .mdf-mirror')!;
    const plain = styled.cloneNode(false) as HTMLElement;
    plain.textContent = textarea.value;
    styled.after(plain);
    plain.scrollTop = styled.scrollTop;
    const end = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node as Text;
      const range = document.createRange();
      range.setStart(last!, last!.length);
      return range.getClientRects()[0]!;
    };
    const a = end(styled);
    const b = end(plain);
    plain.remove();
    return {
      x: Math.abs(a.left - b.left),
      y: Math.abs(a.top - b.top),
      height: styled.scrollHeight - textarea.scrollHeight,
    };
  });
  expect(drift.x).toBeLessThan(0.5);
  expect(drift.y).toBeLessThan(0.5);
  expect(Math.abs(drift.height)).toBeLessThan(1);
});

test('⌘B, ⌘I and ⌘⇧X wrap and unwrap the selection without touching the sidebar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const input = await newChat(page);
  const sidebar = page.getByRole('navigation', { name: 'Chats' });
  await input.pressSequentially('make this bold');
  await selectBack(input, 4);
  await input.press('ControlOrMeta+b');
  await expect(input).toHaveValue('make this **bold**');
  await input.press('ControlOrMeta+b');
  await expect(input).toHaveValue('make this bold');
  await input.press('ControlOrMeta+i');
  await expect(input).toHaveValue('make this _bold_');
  await input.press('ControlOrMeta+Shift+x');
  await expect(input).toHaveValue('make this _~~bold~~_');
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('make this _bold_');
  await expect(sidebar).toHaveJSProperty('inert', false);
  await expect(page.getByRole('searchbox')).not.toBeFocused();
});

test('the selection toolbar and the Aa bar format without taking the focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const input = await newChat(page);
  await input.pressSequentially('see the ticket');
  await selectBack(input, 10);
  const floating = page.getByRole('toolbar', { name: 'Format selection' });
  await expect(floating).toBeVisible();
  await floating.getByRole('button', { name: 'Link' }).click();
  const editor = page.getByRole('dialog', { name: 'Add link' });
  await expect(editor.getByRole('textbox', { name: 'Link' })).toBeFocused();
  await editor.getByRole('textbox', { name: 'Link' }).fill('https://x.example/1');
  await editor.getByRole('textbox', { name: 'Link' }).press('Enter');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('see [the ticket](https://x.example/1)');
  await selectBack(input, 33);
  await expect(floating).toBeVisible();
  await floating.getByRole('button', { name: 'Code' }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('see `[the ticket](https://x.example/1)`');

  await page.getByRole('button', { name: 'Add files and context' }).click();
  const toggle = page.getByRole('menuitemcheckbox', { name: 'Formatting' });
  await toggle.click();
  await expect(input).toBeFocused();
  const bar = page.getByRole('toolbar', { name: 'Formatting' });
  await input.press('ControlOrMeta+a');
  await expect(floating).toBeHidden();
  await bar.getByRole('button', { name: 'Quote' }).click();
  await expect(input).toHaveValue('> see `[the ticket](https://x.example/1)`');
  await expect(bar.getByRole('button', { name: 'Bold' })).toHaveAttribute(
    'aria-keyshortcuts',
    /^(Meta|Control)\+B$/,
  );
});

test('Enter adds a line inside a code block and sends once the block is closed', async ({
  page,
}) => {
  const bodies = sentBodies(page);
  const input = await newChat(page);
  await input.pressSequentially('```');
  await input.press('Enter');
  await input.pressSequentially('const a = 1;');
  await input.press('Enter');
  await input.pressSequentially('```');
  await expect(input).toHaveValue('```\nconst a = 1;\n```');
  await expect(page.locator('.composer .mdl-code')).toHaveText('const a = 1;');
  expect(bodies).toEqual([]);
  await input.press('Enter');
  await expect.poll(() => bodies).toEqual(['```\nconst a = 1;\n```']);
  await expect(page.locator('.msg.ai').last()).toContainText('You wrote:', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

  await input.pressSequentially('```');
  await input.press('Enter');
  await input.pressSequentially('open');
  await input.press('ControlOrMeta+Enter');
  await expect.poll(() => bodies).toHaveLength(2);
  expect(bodies[1]).toBe('```\nopen');
});

test('pasting rich text gives Markdown, pasted Markdown stays as it is', async ({ page }) => {
  const input = await newChat(page);
  const paste = (html: string, plain: string) =>
    input.evaluate(
      (element, data) => {
        const transfer = new DataTransfer();
        transfer.setData('text/html', data.html);
        transfer.setData('text/plain', data.plain);
        const event = new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        });
        return element.dispatchEvent(event);
      },
      { html, plain },
    );
  expect(
    await paste('<p><b>Bold</b> and <a href="https://x.example">a link</a></p>', 'Bold and a link'),
  ).toBe(false);
  await expect(input).toHaveValue('**Bold** and [a link](https://x.example)');
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('');
  expect(await paste('<p>- <b>a</b></p>', '- **a**')).toBe(true);
  expect(await paste('<span>plain words</span>', 'plain words')).toBe(true);
});

test('sends exactly what was typed and shows it as Markdown in the thread', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const bodies = sentBodies(page);
  const input = await newChat(page);
  await input.fill(MESSAGE);
  await expect(input).toHaveValue(MESSAGE);
  await input.press('ControlOrMeta+End');
  await input.press('Enter');
  await expect.poll(() => bodies).toEqual([MESSAGE]);

  const bubble = page.locator('.msg.me .bubble').last();
  await expect(bubble.locator('strong')).toHaveText('Ship blocker:');
  await expect(bubble.locator('em')).toHaveText('row-level');
  await expect(bubble.locator('li')).toHaveCount(2);
  await expect(bubble.locator('del')).toHaveText('admins');
  await expect(bubble.locator('blockquote')).toContainText('from the CP-49259 review');
  await expect(bubble.locator('pre')).toContainText('expect(canExportAll(member)).toBe(false);');
  const link = bubble.getByRole('link', { name: 'the ticket' });
  await expect(link).toHaveAttribute('href', 'https://acme.example/browse/CP-49259');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(bubble).not.toContainText('**');

  await expect(page.locator('.msg.ai').last()).toContainText('You wrote:', { timeout: 20_000 });
  const chats = (await (await page.request.get('/api/conversations')).json()) as { id: string }[];
  const messages = async () => {
    const response = await page.request.get(`/api/conversations/${chats[0]!.id}`);
    return ((await response.json()) as { messages: { role: string; content: string }[] }).messages;
  };
  const said = async (role: string) =>
    (await messages()).find((message) => message.role === role)?.content ?? '';
  expect(await said('user')).toBe(MESSAGE);
  await expect
    .poll(() => said('assistant'), { timeout: 20_000 })
    .toContain(`You wrote: "${MESSAGE}"`);
});

test('a message with raw HTML or unsafe links renders no HTML and no unsafe link', async ({
  page,
}) => {
  const input = await newChat(page);
  await input.fill('<img src=x onerror="window.hit=1"> [run](javascript:window.hit=2) **ok**');
  await input.press('Enter');
  const bubble = page.locator('.msg.me .bubble').last();
  await expect(bubble.locator('strong')).toHaveText('ok');
  await expect(bubble.locator('img')).toHaveCount(0);
  await expect(bubble.getByRole('link')).toHaveCount(0);
  expect(await page.evaluate(() => (window as { hit?: number }).hit)).toBeUndefined();
});

test('/ commands and @ mentions still open from the Markdown box', async ({ page }) => {
  expect(
    (
      await page.request.post('/api/teammates', {
        data: { name: 'Pip', role: 'Code reviewer', instructions: 'Point to the line.' },
      })
    ).status(),
  ).toBe(201);
  const input = await newChat(page);
  await input.pressSequentially('/');
  await expect(page.getByRole('listbox', { name: 'Commands' })).toBeVisible();
  await input.press('Escape');
  await input.fill('');
  await input.pressSequentially('**Ask** @Pi');
  const sparks = page.getByRole('listbox', { name: 'Sparks' });
  await expect(sparks).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue(/^\*\*Ask\*\* @Pip /);
});

test('a quote keeps its Markdown and a > line inside a code block stays code', async ({ page }) => {
  const input = await newChat(page);
  await input.fill('> **from** the review\n\n```sh\n> npm test\n```\nafter');
  await input.press('ControlOrMeta+End');
  await input.press('Enter');
  const bubble = page.locator('.msg.me .bubble').last();
  await expect(bubble.locator('blockquote strong')).toHaveText('from');
  await expect(bubble.locator('pre')).toHaveCount(1);
  await expect(bubble.locator('pre')).toContainText('> npm test');
  await expect(bubble).not.toContainText('**');
});

test('IME composition shows in the styled layer and Enter while composing does not send', async ({
  page,
}) => {
  const bodies = sentBodies(page);
  const input = await newChat(page);
  await input.pressSequentially('**');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
  await expect(mirror(page)).toContainText('**にほん');
  await cdp.send('Input.insertText', { text: '日本' });
  await input.pressSequentially('**');
  await expect(input).toHaveValue('**日本**');
  await expect(mirror(page).locator('.mdm-strong')).toHaveText('日本');
  expect(bodies).toEqual([]);
});

test('a long draft updates the styled layer quickly', async ({ page }) => {
  const input = await newChat(page);
  const line = 'Some **bold** and _italic_ with `code` and [a link](https://x.example) here';
  await input.fill(Array.from({ length: 3_000 }, () => line).join('\n'));
  await expect(mirror(page).locator('.mdl')).toHaveCount(3_000);
  const elapsed = await input.evaluate(async (element) => {
    const textarea = element as HTMLTextAreaElement;
    const lines = () => document.querySelectorAll('.composer .mdf-mirror .mdl').length;
    const before = lines();
    const started = performance.now();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    document.execCommand('insertText', false, '\nnew **line**');
    while (lines() === before) await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - started;
  });
  expect(elapsed).toBeLessThan(250);
});
