import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { PIECE_CHECK_SCRIPT } from '../../apps/server/test/fake-acp-coordinator.ts';
import {
  autoContinueAfter,
  buildThePlan,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  repo.commit('piece-check.mjs', PIECE_CHECK_SCRIPT);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

test('steering a running piece from the chat queues a note it reads at its next turn', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await autoContinueAfter(page, 3);
  await crewChat(page, repo, 'Full auto');
  await send(
    page,
    'Split this up: build a store, add an API and add a view. #build #pieces #holdpiece',
  );
  await buildThePlan(page);

  const board = page.getByRole('region', { name: 'Pieces' });
  const api = board
    .getByRole('listitem')
    .filter({ has: page.locator('.piece-key', { hasText: /^P2$/ }) });
  await expect(api).toContainText('running', { timeout: 60_000 });

  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toHaveAttribute('placeholder', 'Steer the pieces while they run');
  const target = page.getByRole('button', { name: 'Steer to' });
  await expect(target).toHaveText('Auto');
  await target.click();
  const menu = page.getByRole('menu', { name: 'Steer to' });
  await expect(menu.getByRole('menuitemradio')).toHaveText([
    /^Auto/,
    /^All pieces/,
    /^P2 · API/,
    /^P3 · View/,
    /^Coordinator/,
  ]);
  await menu.getByRole('menuitemradio', { name: /^P2 · API/ }).click();
  await expect(target).toHaveText('P2 · API');
  await expect(target).toBeFocused();

  await input.fill('Also return JSON with a version field');
  await page.getByRole('button', { name: 'Send to the pieces' }).click();
  await expect(
    page.locator('.composer-notice[role="status"]').filter({ hasText: 'Queued' }),
  ).toHaveText('Queued for Rivet: return JSON with a version field (next turn)');
  await expect(input).toHaveValue('');
  await expect(api).toContainText('1 note queued');

  await page.getByRole('button', { name: 'Agent TV' }).click();
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await tv.getByRole('radio', { name: 'Stage' }).click();
  await expect(tv.locator('.tv-n.jev')).toContainText('Coordinator');
  const spoke = (key: string) => tv.locator(`.tv-n[data-piece="${key}"]`);
  await expect(spoke('P1')).toHaveAttribute('aria-label', /P1 Store, in order, landed, Jev: .+\./);
  await expect(spoke('P2')).toHaveAttribute(
    'aria-label',
    /^Rivet, P2 API, in order, running, 1 note queued, Jev: .+\./,
  );
  await expect(spoke('P2').locator('.tv-notes')).toHaveText('1');
  await expect(spoke('P3')).toHaveAttribute('aria-label', /P3 View, in order, waiting, Jev: .+\./);
  await expect(spoke('P3').locator('.piece-state')).toHaveText('waiting');
  await expect(spoke('P3')).toContainText('in order');
  await tv.getByRole('radio', { name: 'List' }).click();
  const rivet = tv.getByRole('listitem', { name: /^Rivet/ });
  await expect(rivet).toContainText('P2 · API · in order');
  await expect(rivet.locator('.piece-state')).toHaveText('running');
  await expect(rivet).toContainText('1 note queued');
  await tv.getByRole('button', { name: 'Close Agent TV' }).click();

  writeFileSync(path.join(repo.root, '.git', 'release-P2'), 'go');
  await expect(board).toContainText('3 pieces, in order · 3 landed', { timeout: 60_000 });
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });
  await expect(target).toBeHidden();
  expect(repo.file('api.ts')).toContain('noted');
});
