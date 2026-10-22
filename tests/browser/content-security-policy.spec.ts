import { expect, test, type Page } from '@playwright/test';
import {
  appContentSecurityPolicy,
  devContentSecurityPolicy,
} from '../../packages/contracts/src/content-security-policy.ts';
import { artifactOrigin } from '../../packages/contracts/src/artifact-pages.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { headerPaneItem, openChatMenu } from './header-menu.ts';
import { API_PORT, PACKAGED } from './stub-config.ts';

declare global {
  interface Window {
    cspViolations?: string[];
  }
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function collectViolations(page: Page) {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.cspViolations!.push(`${event.effectiveDirective} ${event.blockedURI || 'inline'}`);
    });
  });
}

const violations = (page: Page) => page.evaluate(() => window.cspViolations ?? []);

async function openRailItem(page: Page, name: string) {
  const more = rail(page).getByRole('button', { name: /^More/ });
  if (await more.isVisible()) await more.click();
  await rail(page).getByRole('button', { name, exact: true }).click();
}

test('the app runs under its content security policy with no violations @packaged', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await collectViolations(page);
  const shell = await page.goto('/');
  expect(shell?.headers()['content-security-policy']).toBe(
    PACKAGED || process.env.SPARK_WEB_BUILD
      ? appContentSecurityPolicy(artifactOrigin(API_PORT))
      : devContentSecurityPolicy(artifactOrigin(API_PORT)),
  );

  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  const marker = `Policy check ${Date.now()}`;
  await input.fill(`${marker}\n\n\`\`\`ts\nconst answer = 42;\n\`\`\``);
  await input.press('Enter');
  await expect(page.locator('.md', { hasText: `You wrote: "${marker}` })).toBeVisible({
    timeout: 15_000,
  });

  await openChatMenu(page);
  await headerPaneItem(page, 'Terminal').click();
  const dock = page.getByRole('region', { name: 'Terminal' });
  await expect(dock.locator('.xterm')).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Profile & personality' });
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', { name: 'Appearance' }).click();
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();

  await openRailItem(page, 'Docs');
  await expect(page.getByRole('main', { name: 'Docs' })).toBeVisible();
  await openRailItem(page, 'Analytics');
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await page.goto('/island');
  await expect(page.getByRole('region', { name: 'Spark Island' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
