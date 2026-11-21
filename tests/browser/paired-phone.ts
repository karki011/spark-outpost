import type { Page } from '@playwright/test';
import type { RemoteSession } from '../../packages/contracts/src/remote.ts';

export async function asPairedPhone(page: Page): Promise<void> {
  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    const session = (await response.json()) as RemoteSession;
    await route.fulfill({ response, json: { ...session, remote: true } });
  });
}
