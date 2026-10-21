import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-island-drop-')));
  mkdirSync(path.join(base, 'my-repo'));
});

test.afterAll(() => rmSync(base, { recursive: true, force: true }));

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });
const scene = (page: Page) => page.locator('.isl-drop');

interface FakeFile {
  name: string;
  type?: string;
  size?: number;
  png?: boolean;
  folder?: boolean;
}

async function openResting(page: Page) {
  await page.addInitScript(
    (folderPath) => {
      const none = () => () => undefined;
      const proto = DataTransferItem.prototype as unknown as {
        webkitGetAsEntry: () => { isDirectory: boolean } | null;
      };
      const original = proto.webkitGetAsEntry;
      proto.webkitGetAsEntry = function (this: DataTransferItem) {
        const file = this.getAsFile();
        if (file?.name === 'my-repo') return { isDirectory: true };
        return original.call(this);
      };
      Object.assign(window, {
        sparkDesktop: {
          platform: 'darwin',
          companion: { get: async () => null, onChange: none },
          island: {
            geometry: async () => ({
              notch: false,
              top: 24,
              notchWidth: 0,
              docked: true,
              menuBar: 24,
            }),
            onGeometry: none,
            onCommand: none,
            onEscape: none,
            sparkFocused: async () => true,
            onSparkFocus: none,
            pickFolder: async () => null,
            pathForFile: (file: File) => (file.name === 'my-repo' ? folderPath : null),
            setInteractive: () => undefined,
            setFocusable: () => undefined,
            drag: () => undefined,
            openChat: () => undefined,
            setRestSize: () => undefined,
          },
          onOpenChat: none,
        },
      });
    },
    path.join(base, 'my-repo'),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await page.waitForTimeout(600);
}

async function drag(
  page: Page,
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  files: FakeFile[],
  at: { x: number; y: number },
) {
  await page.evaluate(
    ({ type, files, at, png }) => {
      const transfer = new DataTransfer();
      for (const file of files) {
        const body = file.png
          ? Uint8Array.from(atob(png), (char) => char.charCodeAt(0))
          : 'x'.repeat(file.size ?? 12);
        transfer.items.add(new File([body], file.name, { type: file.type ?? '' }));
      }
      const target =
        document.elementFromPoint(at.x, at.y) ?? document.querySelector('.isl-scout-btn')!;
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: at.x,
          clientY: at.y,
          relatedTarget: null,
        }),
      );
    },
    { type, files, at, png: PNG },
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({
    path: path.join(SHOTS, `island-drop-${name}.png`),
    clip: { x: 300, y: 0, width: 680, height: 360 },
  });
}

const BLOB = { x: 640, y: 6 };
const PANEL = { x: 640, y: 120 };

test('dropping an image and a text file grabs them into a new chat', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openResting(page);
  const files = [
    { name: 'shot.png', type: 'image/png', png: true },
    { name: 'notes.md', type: 'text/markdown' },
  ];
  await drag(page, 'dragenter', files, BLOB);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page).getByRole('button', { name: 'New chat', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(scene(page)).toHaveAttribute('data-phase', 'enter');
  await expect(scene(page)).toContainText('Drop to add to a new chat');
  await page.waitForTimeout(400);
  await shot(page, '1-enter');
  await drag(page, 'dragover', files, PANEL);
  await expect(scene(page)).toHaveAttribute('data-phase', 'over');
  await expect(scene(page).locator('.isl-arms')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, '2-over');
  await drag(page, 'drop', files, PANEL);
  await expect(scene(page)).toHaveAttribute('data-phase', 'drop');
  await page.waitForTimeout(250);
  await shot(page, '3-drop');
  await expect(scene(page)).toHaveAttribute('data-phase', 'chew');
  await expect(scene(page)).toContainText('Having a look…');
  await expect(scene(page).locator('.isl-drop-chip')).toHaveText('shot.png+1');
  await shot(page, '3b-chew');
  await expect(scene(page)).toHaveAttribute('data-phase', 'done');
  await expect(scene(page)).toContainText('Added to a new chat');
  await expect(scene(page)).toBeHidden({ timeout: 3000 });
  const chips = island(page).getByRole('group', { name: 'Attachments' });
  await expect(chips.getByRole('button', { name: 'Remove shot.png' })).toBeVisible();
  await expect(chips.getByRole('button', { name: 'Remove notes.md' })).toBeVisible();
  await shot(page, '4-chips');
  const frame = (await island(page).boundingBox())!;
  const box = (await chips.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(frame.x);
  expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
});

async function dropFolder(page: Page) {
  const files = [{ name: 'my-repo', size: 0 }];
  await drag(page, 'dragenter', files, BLOB);
  await drag(page, 'dragover', files, PANEL);
  await drag(page, 'drop', files, PANEL);
  await expect(scene(page)).toHaveAttribute('data-phase', 'drop');
  await expect(scene(page)).toHaveAttribute('data-phase', 'choose', { timeout: 4000 });
  await expect(scene(page)).toContainText('my-repo is a folder');
  return scene(page).getByRole('group', { name: 'What to do with my-repo' });
}

async function projectNames(page: Page): Promise<string[]> {
  const projects = (await (await page.request.get('/api/projects')).json()) as { name: string }[];
  return projects.map((project) => project.name);
}

test('a dropped folder offers a chat there or a project, and Start a chat here links it', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openResting(page);
  const choice = await dropFolder(page);
  await expect(choice.getByRole('button')).toHaveText([
    'Start a chat here',
    'Add as project',
    'Cancel',
  ]);
  await expect(choice.getByRole('button', { name: 'Start a chat here' })).toBeFocused();
  expect(await projectNames(page)).toEqual([]);
  await shot(page, '6-choose');
  await page.keyboard.press('Enter');
  await expect(scene(page)).toContainText('New chat in my-repo');
  await expect(scene(page)).toBeHidden({ timeout: 3000 });
  await expect(island(page).getByRole('button', { name: 'my-repo' })).toBeVisible();
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toBeVisible();
});

test('Add as project links the folder and goes back; Escape links nothing', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openResting(page);
  await dropFolder(page);
  await page.keyboard.press('Escape');
  await expect(scene(page)).toHaveAttribute('data-phase', 'leave');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  expect(await projectNames(page)).toEqual([]);

  const choice = await dropFolder(page);
  await choice.getByRole('button', { name: 'Add as project' }).click();
  await expect(scene(page)).toContainText('my-repo is a project now');
  await expect.poll(() => projectNames(page)).toEqual(['my-repo']);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(scene(page)).toBeHidden({ timeout: 3000 });
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('files dropped while replying to a Spark go to that reply', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const made = await page.request.post('/api/teammates', {
    data: { name: 'Docs', role: 'Helper', face: { shape: 'boxy', color: 'moss' } },
  });
  expect(made.status()).toBe(201);
  await openResting(page);
  await island(page)
    .getByRole('button', { name: /Open Spark Island/ })
    .click();
  await island(page).getByRole('button', { name: 'New chat' }).click();
  await island(page).getByRole('region', { name: 'Your Sparks' }).getByText('Docs').click();
  await expect(island(page)).toContainText('Following up in Docs');
  const files = [{ name: 'notes.md', type: 'text/markdown' }];
  await drag(page, 'dragenter', files, PANEL);
  await expect(scene(page)).toContainText('Drop to add to your reply');
  await drag(page, 'drop', files, PANEL);
  await expect(scene(page)).toContainText('Added to your reply', { timeout: 4000 });
  await expect(scene(page)).toBeHidden({ timeout: 3000 });
  await expect(island(page)).toContainText('Following up in Docs');
  await expect(
    island(page).getByRole('group', { name: 'Attachments' }).getByText('notes.md'),
  ).toBeVisible();
});

test('a secret file is refused with a head shake and a note, a huge file shows an error', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openResting(page);
  const secret = [{ name: '.env', type: 'text/plain' }];
  await drag(page, 'dragenter', secret, BLOB);
  await drag(page, 'dragover', secret, PANEL);
  await drag(page, 'drop', secret, PANEL);
  await expect(scene(page)).toHaveAttribute('data-phase', 'reject');
  await expect(scene(page)).toContainText('Skipped .env: Spark never reads secret files.');
  await page.waitForTimeout(300);
  await shot(page, '5-reject');
  await expect(scene(page)).toBeHidden({ timeout: 3000 });
  await expect(island(page).getByRole('group', { name: 'Attachments' })).toHaveCount(0);
  await expect(island(page)).toContainText('Skipped .env');

  const huge = [{ name: 'dump.log', type: 'text/plain', size: 600 * 1024 }];
  await drag(page, 'dragenter', huge, PANEL);
  await drag(page, 'drop', huge, PANEL);
  await expect(scene(page)).toHaveAttribute('data-phase', 'reject');
  await expect(island(page).getByRole('group', { name: 'Attachments' })).toContainText(
    'Text files can be up to',
  );
});

test('a drag that leaves without dropping droops and closes again', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openResting(page);
  const files = [{ name: 'notes.md', type: 'text/markdown' }];
  await drag(page, 'dragenter', files, BLOB);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await drag(page, 'dragleave', files, BLOB);
  await expect(scene(page)).toHaveAttribute('data-phase', 'leave');
  await expect(scene(page)).toContainText('Maybe next time');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('with reduced motion the grab keeps still and only the face and words change', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openResting(page);
  const files = [{ name: 'notes.md', type: 'text/markdown' }];
  await drag(page, 'dragenter', files, BLOB);
  await drag(page, 'dragover', files, PANEL);
  await expect(scene(page)).toHaveAttribute('data-phase', 'over');
  await expect(scene(page).locator('.isl-arms')).toBeHidden();
  await expect(scene(page).locator('.isl-drop-blob')).toHaveCSS('animation-name', 'none');
  await drag(page, 'drop', files, PANEL);
  await expect(scene(page)).toHaveAttribute('data-phase', 'drop');
  await expect(scene(page)).toHaveAttribute('data-phase', 'chew');
  await expect(scene(page).locator('.isl-drop-blob')).toHaveCSS('animation-name', 'none');
  await expect(scene(page)).toHaveAttribute('data-phase', 'done');
  await expect(scene(page).locator('svg.scout')).toHaveClass(/\bhappy\b/);
  await expect(
    island(page).getByRole('group', { name: 'Attachments' }).getByText('notes.md'),
  ).toBeVisible({ timeout: 3000 });
});
