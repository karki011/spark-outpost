import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { THEMES } from '../../scripts/contrast/theme.ts';
import { animationsSettled } from './settle.ts';

export const connectorCard = (scope: Page | Locator, id: string) =>
  scope.locator(`.cx-card[data-connector="${id}"]`);

export const connectorHead = (card: Locator) => card.locator('button.pc-head');

export const connectorStatus = (card: Locator) => card.locator('.pc-head .nm small');

export async function axeInEveryTheme(page: Page, include: string): Promise<void> {
  await page.mouse.move(0, 0);
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme === 'system-dark' ? 'dark' : 'light' });
    await page.evaluate((skin) => {
      if (skin.startsWith('system')) delete document.documentElement.dataset.skin;
      else document.documentElement.dataset.skin = skin;
    }, theme);
    await animationsSettled(page);
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .include(include)
      .analyze();
    expect(scan.violations, theme).toEqual([]);
  }
}
