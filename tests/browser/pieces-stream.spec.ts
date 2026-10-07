import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PIECE_CHECK_SCRIPT, SPLIT_RELEASE } from '../../apps/server/test/fake-acp-coordinator.ts';
import { agentHead, crewChat, crewRepo, resetCrew, send, type CrewRepo } from './crew-engine.ts';
import { fakeHomeDesktop, island, openIsland } from './island-home-desktop.ts';

const SHOTS = process.env.PIECES_SHOTS ?? '';
const REQUEST =
  'Split this up: build a store, add an API and add a view. #build #pieces #slowsplit #holdpiece';
const WRITING = 'Splitting the work into pieces… 2 pieces so far.';
const READY = 'Split the work into 3 pieces.';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  repo.commit('piece-check.mjs', PIECE_CHECK_SCRIPT);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

async function watchForPieceJson(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const leaks = new Set<string>();
    Object.assign(window, { pieceLeaks: leaks });
    const look = () => {
      const text = document.body?.textContent ?? '';
      for (const key of ['"dependsOn"', '"acceptance"']) {
        if (text.includes(key)) leaks.add(key);
      }
      for (const caption of document.querySelectorAll('.md-code figcaption span')) {
        if (['pieces', 'json'].includes(caption.textContent ?? '')) leaks.add('code block');
      }
    };
    new MutationObserver(look).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

function leaks(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { pieceLeaks: Set<string> }).pieceLeaks]);
}

async function shots(page: Page): Promise<void> {
  if (!SHOTS) return;
  for (const [name, skin] of Object.entries({ dark: 'graphite', light: 'fjord' })) {
    await page.evaluate((skin) => {
      document.documentElement.dataset.skin = skin;
    }, skin);
    await page
      .locator('.crew-turn')
      .screenshot({ path: path.join(SHOTS, `placeholder-${name}.png`) });
  }
  await page.evaluate(() => {
    document.documentElement.dataset.skin = 'graphite';
  });
}

const sessionLog = (page: Page) => island(page).getByRole('log', { name: 'Recent messages' });

async function showSession(page: Page): Promise<void> {
  await openIsland(page);
  await page.waitForFunction(() => 'islandCommand' in window);
  await page.evaluate(() =>
    (window as unknown as { islandCommand: (action: string) => void }).islandCommand('sessions'),
  );
  await island(page)
    .getByRole('listbox', { name: 'Recent sessions' })
    .getByRole('option')
    .first()
    .click();
  await expect(sessionLog(page)).toContainText('Split this up');
}

test('the Coordinator splitting the work shows one calm line and never the piece JSON', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await watchForPieceJson(context);
  await crewChat(page, repo, 'Full auto');
  await send(page, REQUEST);

  const atlas = page.locator('.agent-block', {
    has: page.locator('.agent-name', { hasText: /^Atlas$/ }),
  });
  const note = atlas.getByRole('status');
  await expect(note).toHaveText(WRITING, { timeout: 90_000 });
  await expect(atlas).toContainText('Here is the split.');
  await expect(atlas.locator('.md-code')).toHaveCount(0);
  await expect(atlas.getByRole('button', { name: /Copy/ })).toHaveCount(0);
  const writingBox = (await note.boundingBox())!;
  await shots(page);
  expect(await leaks(page)).toEqual([]);

  await atlas.getByRole('button', { name: 'Message Atlas' }).click();
  const tail = page.getByRole('group', { name: "Atlas's latest work" });
  await expect(tail).toContainText(WRITING);
  await page.keyboard.press('Escape');

  const session = await context.newPage();
  await fakeHomeDesktop(session);
  await showSession(session);
  expect(await leaks(session)).toEqual([]);

  await page.reload();
  await expect(note).toHaveText(WRITING, { timeout: 30_000 });
  await expect(atlas.locator('.md-code')).toHaveCount(0);
  expect(await leaks(page)).toEqual([]);

  writeFileSync(path.join(repo.root, '.git', SPLIT_RELEASE), 'go');
  const board = page.getByRole('region', { name: 'Pieces' });
  await expect(board.getByRole('listitem')).toHaveCount(3, { timeout: 60_000 });
  await showSession(session);
  await expect(sessionLog(session).locator('.md-code')).toHaveCount(0);
  writeFileSync(path.join(repo.root, '.git', 'release-P2'), 'go');
  await expect(board).toContainText('3 pieces, in the shared tree · 3 landed', { timeout: 90_000 });
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });

  await agentHead(page, 'Atlas').click();
  await expect(note).toHaveText(READY);
  const readyBox = (await note.boundingBox())!;
  expect(readyBox.height).toBe(writingBox.height);
  await expect(atlas.locator('.md-code')).toHaveCount(0);
  expect(await leaks(page)).toEqual([]);
});

test('a piece list the Coordinator proposes as a plan stays out of the chat too', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await watchForPieceJson(context);
  await crewChat(page, repo, 'Full auto');
  await send(
    page,
    'Split this up: build a store, add an API and add a view. #build #pieces #planfile',
  );

  const board = page.getByRole('region', { name: 'Pieces' });
  await expect(board).toContainText('3 pieces, in the shared tree · 3 landed', {
    timeout: 120_000,
  });
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });
  await agentHead(page, 'Atlas').click();
  expect(await leaks(page)).toEqual([]);
});
