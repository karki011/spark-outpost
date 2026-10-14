import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { startFixtureTerminal, typeLine } from './native-terminal-fixture.ts';

const APRICOT = 'background[]11;rgb:fafa/f2f2/ebeb]';
const GRAPHITE = 'background[]11;rgb:0e0e/1212/1515]';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test('the CLI in a Terminal session reads the theme background once, also after a theme switch and a reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('spark-outpost.theme'))
      localStorage.setItem('spark-outpost.theme', 'apricot');
  });
  const workspace = await startFixtureTerminal(page);
  const screen = workspace.locator('.xterm-accessibility');
  await typeLine(page, workspace, 'fixture background');
  await expect(screen).toContainText(APRICOT);

  await page.evaluate(() => {
    document.documentElement.dataset.skin = 'graphite';
    localStorage.setItem('spark-outpost.theme', 'graphite');
  });
  await typeLine(page, workspace, 'fixture background again');
  await expect(screen).toContainText(GRAPHITE);

  await page.evaluate(() => localStorage.setItem('spark-outpost.theme', 'apricot'));
  await page.reload();
  const reopened = page.getByRole('region', { name: 'Terminal session', exact: true });
  await expect(reopened.locator('.xterm-accessibility')).toContainText(GRAPHITE);
  await typeLine(page, reopened, 'fixture background after reload');
  await expect
    .poll(async () => (await reopened.locator('.xterm-accessibility').textContent()) ?? '')
    .toMatch(/after reload\s*background\[\]11;rgb:fafa\/f2f2\/ebeb\]/);
});
