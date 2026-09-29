import type { Locator, Page } from '@playwright/test';

export const connectorCard = (scope: Page | Locator, id: string) =>
  scope.locator(`.cx-card[data-connector="${id}"]`);

export const connectorHead = (card: Locator) => card.locator('button.pc-head');

export const connectorStatus = (card: Locator) => card.locator('.pc-head .nm small');
