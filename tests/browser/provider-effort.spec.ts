import { expect, test, type Page } from '@playwright/test';
import {
  CREW_REQUEST,
  agentHead,
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
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

async function chooseClaudeDefault(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const claude = providers.locator('.pconf[data-prov="claude"]');
  await providers.locator('.ptile[data-prov="claude"]').click();
  const effort = claude.getByRole('button', { name: 'Claude effort' });
  await expect(effort).toHaveText('high');

  await effort.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Claude effort' });
  const items = menu.getByRole('menuitemradio');
  await expect(items.first()).toContainText('Per chat');
  await expect(menu.getByRole('menuitemradio', { name: /^high/ })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(effort).toHaveText('Per chat');
  await expect(claude).toContainText(
    'Each chat keeps its own effort, and Do-task Builders follow it.',
  );

  await effort.click();
  await menu.getByRole('menuitemradio', { name: /^low/ }).click();
  await expect(effort).toHaveText('low');
  await expect(claude).toContainText('Do-task Builders always use this effort.');
  await page.keyboard.press('Escape');
  await expect(providers.locator('.ptile[data-prov="claude"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(providers).toHaveCount(0);
}

test('the Claude default effort preselects fresh chats and sets the Builder effort', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await chooseClaudeDefault(page);
  await crewChat(page, repo, 'Full auto');

  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await panel.getByRole('tab', { name: /Effort/ }).click();
  const efforts = panel.getByRole('radiogroup', { name: 'Effort' });
  await expect(efforts.getByRole('radio', { name: /^low/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await efforts.getByRole('radio', { name: /^high/ }).click();
  await expect(panel.getByRole('tab', { name: /Effort/ })).toContainText('high');
  await page.keyboard.press('Escape');

  await send(page, `${CREW_REQUEST} #build #crew`);
  await expect(agentHead(page, 'Bolt')).toContainText('Builder', { timeout: 30_000 });
  await expect(agentHead(page, 'Bolt')).toContainText('Opus 5.5low effort');
});
