import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGMwObwYiBggFAArKgZp8w3CnwAAAABJRU5ErkJggg==';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function newChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();
  return input;
}

function chips(page: Page) {
  return page.getByRole('group', { name: 'Attachments' }).first();
}

async function dispatchFileDrag(page: Page, type: 'dragenter' | 'dragleave' | 'drop') {
  await page.evaluate(
    ({ type, png }) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
      transfer.items.add(new File(['zip'], 'archive.zip', { type: 'application/zip' }));
      const target = document.querySelector('.thread-wrap') ?? document.body;
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    { type, png: PNG_BASE64 },
  );
}

test('uploads from the file chooser, sends with the message, and survives a reload @packaged', async ({
  page,
}) => {
  const input = await newChat(page);
  await page.getByRole('button', { name: 'Add files and context' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Upload a file' }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Remember the milk\n') },
    { name: 'extra.txt', mimeType: 'text/plain', buffer: Buffer.from('Not needed\n') },
  ]);

  await expect(chips(page).getByRole('img', { name: 'a.png' })).toBeVisible();
  await expect(chips(page)).toContainText('notes.txt');
  await page.getByRole('button', { name: 'Remove extra.txt' }).click();
  await expect(chips(page)).not.toContainText('extra.txt');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();

  await input.fill('What is in these?');
  await input.press('Enter');

  const bubble = page.locator('.msg.me').last();
  await expect(bubble.getByRole('button', { name: 'View a.png' })).toBeVisible();
  await expect(bubble.getByRole('link', { name: /notes\.txt/ })).toBeVisible();
  await expect(page.locator('.chips .chip-slot')).toHaveCount(0);
  const reply = page.locator('.md', { hasText: 'Attachments: a.png, notes.txt.' });
  await expect(reply).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText('What is in these?').click();
  const image = page.locator('.msg.me').getByRole('img', { name: 'a.png' });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator('.msg.me').getByRole('link', { name: /notes\.txt/ })).toHaveAttribute(
    'href',
    /\/api\/attachments\/.+\/content$/,
  );

  await page.getByRole('button', { name: 'View a.png' }).click();
  const lightbox = page.getByRole('dialog', { name: 'a.png' });
  await expect(lightbox).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();
  await expect(reply).toHaveCount(1);
});

test('dropping files shows the overlay and attaches supported files', async ({ page }) => {
  await newChat(page);
  const overlay = page.getByText('Drop files to attach');

  await dispatchFileDrag(page, 'dragenter');
  await expect(overlay).toBeVisible();
  await dispatchFileDrag(page, 'dragleave');
  await expect(overlay).toBeHidden();

  await dispatchFileDrag(page, 'dragenter');
  await dispatchFileDrag(page, 'drop');
  await expect(overlay).toBeHidden();
  await expect(chips(page).getByRole('img', { name: 'dropped.png' })).toBeVisible();
  await expect(chips(page)).toContainText('Only images and text files can be attached.');
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();

  await page.getByRole('button', { name: 'Remove archive.zip' }).click();
  await expect(chips(page)).not.toContainText('archive.zip');
  await page.getByRole('textbox', { name: 'Message' }).fill('Dropped');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('pasting an image attaches it and plain text still pastes', async ({ page }) => {
  const input = await newChat(page);
  await input.evaluate((element, png) => {
    const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
  }, PNG_BASE64);
  await expect(chips(page).getByRole('img', { name: 'pasted.png' })).toBeVisible();
  await expect(input).toHaveValue('');

  await page.getByRole('button', { name: 'Remove pasted.png' }).click();
  await expect(chips(page).getByRole('img', { name: 'pasted.png' })).toHaveCount(0);

  const textPaste = await input.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'hello');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(textPaste).toBe(false);
});

test('sends files without a message and titles the chat from their names', async ({ page }) => {
  await newChat(page);
  await page.getByRole('button', { name: 'Add files and context' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Upload a file' }).click();
  await (
    await chooser
  ).setFiles([{ name: 'solo.txt', mimeType: 'text/plain', buffer: Buffer.from('just a file\n') }]);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.md', { hasText: 'Attachments: solo.txt.' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('navigation', { name: 'Chats' })).toContainText('solo.txt');
});
