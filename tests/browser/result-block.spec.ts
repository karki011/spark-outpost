import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { git, repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { turnDone } from './project-chat-kit.ts';
import { resetTestDatabase } from './database.ts';
import {
  buildNotes,
  chatIn,
  shoot,
  shootEverywhere,
  SHOTS,
  timeOutLastTurn,
} from './result-block-kit.ts';
import { animationsSettled } from './settle.ts';
import { FAKE_GH_STATE, STUB_PORT } from './stub-config.ts';

test.describe.configure({ timeout: 90_000 });
let base = '';

test.beforeEach(async ({ page, request }) => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-result-')));
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await request.post(`http://127.0.0.1:${STUB_PORT}/github-test/reset`);
  await page.setViewportSize({ width: 1400, height: 1500 });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(FAKE_GH_STATE, { force: true });
});

const result = (page: Page) => page.getByRole('region', { name: /^Kept · / });

async function fullAutoPr(page: Page) {
  const repo = await repoWithRemote(base, 'fullauto');
  writeFileSync(FAKE_GH_STATE, 'octo-cli');
  await chatIn(page, repo, 'Full auto');
  await buildNotes(page);
  return repo;
}

test('Full auto → PR ends in one result line with a PR reference and no publish buttons', async ({
  page,
}) => {
  await fullAutoPr(page);
  const block = result(page);
  await expect(block).toHaveAccessibleName('Kept · 1 file · +1 −0');
  await expect(page.getByRole('group', { name: /Keep these changes\?/ })).toHaveCount(0);
  await expect(
    page.locator('.col').getByRole('button', { name: /Update PR|Open PR|Push branch/ }),
  ).toHaveCount(0);
  await expect(page.locator('.col .lchip')).toHaveCount(0);
  await expect(block.getByRole('button', { name: /Bring changes into/ })).toHaveCount(0);

  const pull = block.getByRole('link', { name: 'Pull request #1, Open' });
  await expect(pull).toHaveCount(0);
  await expect(page.locator('.pr-opened')).toContainText('Opened pull request');
  await expect(page.locator('.pr-opened')).toHaveCount(1);

  await expect(block.getByRole('group', { name: 'How did it go?' })).toHaveCount(0);
  const feedback = page
    .locator('section[data-turn]')
    .last()
    .locator('.turn-meta')
    .getByRole('group', { name: 'How did it go?' });
  await expect(feedback.getByRole('button', { name: 'Good result' })).toBeVisible();
  const line = await block.locator('.result-line').boundingBox();
  const thumbs = await feedback.boundingBox();
  expect(thumbs!.y).toBeGreaterThanOrEqual(line!.y + line!.height - 1);
  await expect(block.getByRole('button', { name: 'Revert to before this run' })).toBeVisible();

  await page.waitForTimeout(300);
  await shoot(page, 'after-full-auto-pr');

  const toggle = block.getByRole('button', { name: 'Kept · 1 file · +1 −0' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const more = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
  await expect(more).toContainText('Kept by Full auto → PR.');
  await expect(more.getByRole('button', { name: 'Open the diff of notes.txt' })).toBeVisible();
  await expect(more.getByRole('button', { name: 'Bring changes into main' })).toBeVisible();
  await expect(more.getByRole('link', { name: 'Pull request #1, Open' })).toHaveText(
    'PR #1 · Open',
  );
  await expect(pull).toHaveAttribute('href', 'https://github.com/acme/widgets/pull/1');
  await shoot(page, 'after-full-auto-pr-expanded');
});

async function automatic(page: Page) {
  const repo = await repoWithRemote(base, 'automatic');
  await chatIn(page, repo, 'Auto-edit');
  await buildNotes(page);
  return repo;
}

test('Automatic keeps on one line with no pull request and nothing to look at', async ({
  page,
}) => {
  await automatic(page);
  const block = result(page);
  await expect(block).toHaveAccessibleName('Kept · 1 file · +1 −0');
  await expect(page.getByRole('group', { name: /Keep these changes\?/ })).toHaveCount(0);
  await expect(block.getByRole('link')).toHaveCount(0);
  await expect(block.locator('.result-note')).toHaveCount(0);
  await expect(page.locator('.col').getByRole('button', { name: /PR|Push/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /^Files changed/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'How did it go?' })).toHaveCount(0);
  const height = (await block.boundingBox())!.height;
  expect(height).toBeLessThan(48);
  await shoot(page, 'after-automatic');
});

test('Bring changes sits in the expanded block and only when the checkout can take it', async ({
  page,
}) => {
  const repo = await automatic(page);
  const block = result(page);
  const toggle = block.getByRole('button', { name: /^Kept · 1 file/ });
  const bring = block.getByRole('button', { name: /^Bring changes into/ });
  await expect(bring).toHaveCount(0);
  await toggle.click();
  await expect(bring).toHaveText('Bring changes into main');
  await expect(bring).toHaveClass('bring-link');

  writeFileSync(path.join(repo.root, 'mine.txt'), 'my own edit\n');
  await toggle.click();
  await toggle.click();
  await expect(block).toContainText('In this chat’s worktree.');
  await expect(bring).toHaveCount(0);

  rmSync(path.join(repo.root, 'mine.txt'));
  git(repo.root, 'checkout', '--orphan', 'elsewhere');
  git(repo.root, 'rm', '-rf', '--quiet', '.');
  writeFileSync(path.join(repo.root, 'other.txt'), 'unrelated\n');
  git(repo.root, 'add', 'other.txt');
  git(repo.root, 'commit', '--quiet', '-m', 'unrelated history');
  await toggle.click();
  await toggle.click();
  await expect(block).toContainText('In this chat’s worktree.');
  await expect(bring).toHaveCount(0);
});

test('a timed-out approval reads as waited for you, says what was asked and retries once', async ({
  page,
}) => {
  await automatic(page);
  await timeOutLastTurn('Run git commit?');
  await page.reload();
  const turn = page.locator('.msg.ai').first();
  await expect(turn).toBeVisible();
  await expect(page.locator('.col')).not.toContainText('hit a problem');
  await expect(page.locator('.col')).toContainText('waited for you');
  await expect(page.locator('.col .error-line')).toHaveCount(0);
  const note = page.getByRole('group', { name: 'Waited for you' });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText(
    'Waited 30 minutes for your answer to “Run git commit?”, then stopped. Nothing after that step ran.',
  );
  await shoot(page, 'after-timeout');
  const retry = note.getByRole('button', { name: 'Try again' });
  await retry.focus();
  await page.keyboard.press('Enter');
  const asked = page.locator('.msg.me', {
    hasText: '“Run git commit?” timed out while waiting for my answer. Try that step again.',
  });
  await expect(asked).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0, {
    timeout: 30_000,
  });
});

test('the result block fits a phone and passes axe in light and dark', async ({ page }) => {
  await fullAutoPr(page);
  const block = result(page);
  await block.getByRole('button', { name: /^Kept · 1 file/ }).click();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((skin) => {
      document.documentElement.dataset.skin = skin === 'light' ? 'light' : 'graphite';
    }, scheme);
    await animationsSettled(page);
    const axe = await new AxeBuilder({ page }).include('section.result').analyze();
    expect(axe.violations, scheme).toEqual([]);
    await shoot(page, `after-expanded-${scheme}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(block).toBeVisible();
  const box = (await block.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(block.getByRole('link', { name: /^Pull request #1, / })).toBeVisible();
  await expect(block.getByRole('button', { name: 'Revert to before this run' })).toBeVisible();
  await block.scrollIntoViewIfNeeded();
  await shoot(page, 'after-phone');
});

test.describe('result block screenshots', () => {
  test.skip(!SHOTS, 'Set SPARK_SHOTS to a folder to take the screenshots.');
  test.describe.configure({ timeout: 180_000 });

  test('a solo turn', async ({ page }) => {
    const repo = await repoWithRemote(base, 'solo');
    await chatIn(page, repo, 'Auto-edit');
    const input = page.getByRole('textbox', { name: 'Message' });
    await input.fill('Add a line to the notes #edit');
    await input.press('Enter');
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await turnDone(page, 30_000);
    await shootEverywhere(page, 'solo');
  });

  test('a turn with a pull request, collapsed and expanded', async ({ page }) => {
    await fullAutoPr(page);
    const block = result(page);
    await expect(page.locator('.pr-opened')).toBeVisible();
    await shootEverywhere(page, 'with-pr');

    await page.setViewportSize({ width: 1400, height: 900 });
    await block.getByRole('button', { name: /^Kept · 1 file/ }).click();
    await expect(block.getByRole('link', { name: /^Pull request #1/ })).toBeVisible();
    await shootEverywhere(page, 'with-pr-expanded');
  });
});

test('a Full auto → PR turn shows the work reply, then the publish result, under one agent header', async ({
  page,
}) => {
  await fullAutoPr(page);
  const turn = page.locator('section[data-turn]').last();
  const publish = turn.getByRole('group', { name: 'Publish result' });
  const shown = async () => {
    await expect(turn.locator('.msg.ai')).toHaveCount(1);
    await expect(turn.locator('.agent-mark')).toHaveCount(0);
    await expect(turn.locator('.msg.ai > .md').first()).toContainText('fake-edit=allowed');
    await expect(publish).toContainText('published=');
    await expect(publish).not.toContainText('fake-edit=allowed');
    const work = (await turn.locator('.msg.ai > .md').first().boundingBox())!;
    const result = (await publish.boundingBox())!;
    expect(work.y + work.height).toBeLessThanOrEqual(result.y);
  };
  await shown();
  await page.reload();
  await shown();
  const violations = await new AxeBuilder({ page })
    .include('.publish-result')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(violations.violations.map((violation) => violation.id)).toEqual([]);

  if (!SHOTS) return;
  await page.setViewportSize({ width: 2000, height: 1100 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((skin) => {
      document.documentElement.dataset.skin = skin === 'light' ? 'light' : 'graphite';
    }, scheme);
    await turn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await turn.screenshot({ path: `${SHOTS}/release-fix-publish-turn-${scheme}.png` });
    await page
      .getByRole('region', { name: 'Chat context' })
      .screenshot({ path: `${SHOTS}/release-fix-rail-${scheme}.png` });
  }
});
