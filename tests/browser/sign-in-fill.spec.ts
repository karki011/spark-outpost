import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Cdp } from '../../apps/desktop/src/browser/cdp.ts';
import { capturePageLogs } from '../../apps/desktop/src/browser/page-capture.ts';
import { readPage } from '../../apps/desktop/src/browser/page-read.ts';
import { RefMap } from '../../apps/desktop/src/browser/ref-map.ts';
import { SIGN_IN_REASONS } from '../../apps/desktop/src/browser/sign-in-fields.ts';
import { SignInError, signInOnPage } from '../../apps/desktop/src/browser/sign-in.ts';
import { scrubberFor } from '../../apps/server/src/spark-mcp/tools/browser/scrub.ts';
import { cdpOf } from './playwright-cdp.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/browser-pane');
const SITE = 'http://vault.test';
const LOOK_ALIKE = 'http://vault.test.evil.test';
const USERNAME = 'vault-user@example.test';
const PASSWORD = 'vault-Passw0rd!-real 7';
const VALUES = { origin: SITE, username: USERNAME, password: PASSWORD };
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};
interface Site {
  cdp: Cdp;
  posted: URLSearchParams[];
}

async function fixtureSite(page: Page, start: string, origin = SITE): Promise<Site> {
  const posted: URLSearchParams[] = [];
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') posted.push(new URLSearchParams(request.postData() ?? ''));
    const name = path.basename(new URL(request.url()).pathname);
    const body = await readFile(path.join(FIXTURES, name)).catch(() => null);
    if (!body) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ body, contentType: TYPES[path.extname(name)] ?? 'text/plain' });
  });
  await page.goto(`${origin}/${start}`);
  return { cdp: cdpOf(await page.context().newCDPSession(page)), posted };
}

async function refused(work: Promise<unknown>): Promise<SignInError> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SignInError);
  return error as SignInError;
}

async function untouched(page: Page) {
  await expect(page.locator('#email')).toHaveValue('old@example.test');
  await expect(page.locator('#password')).toHaveValue('');
}

test('Spark replaces what is in the username field, types the password and submits the form', async ({
  page,
}) => {
  const site = await fixtureSite(page, 'login.html');
  const outcome = await signInOnPage(site.cdp, VALUES);
  expect(outcome).toEqual({ url: `${SITE}/welcome.html`, steps: 1 });
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(site.posted).toHaveLength(1);
  expect(site.posted[0]!.get('email')).toBe(USERNAME);
  expect(site.posted[0]!.get('password')).toBe(PASSWORD);
});

test('Spark follows a username page to its password page on the same site', async ({ page }) => {
  const site = await fixtureSite(page, 'login-step1.html');
  const outcome = await signInOnPage(site.cdp, VALUES);
  expect(outcome).toEqual({ url: `${SITE}/welcome.html`, steps: 2 });
  expect(site.posted).toHaveLength(2);
  expect(site.posted[0]!.get('password')).toBe('');
  expect(site.posted[0]!.get('identifier')).toBe(USERNAME);
  expect(site.posted[1]!.get('password')).toBe(PASSWORD);
});

test('Spark fills nothing on a look-alike host', async ({ page }) => {
  const site = await fixtureSite(page, 'login.html', LOOK_ALIKE);
  const error = await refused(signInOnPage(site.cdp, VALUES));
  expect(error.code).toBe('not_allowed');
  expect(error.message).toContain(`the tab is on ${LOOK_ALIKE}`);
  await untouched(page);
  expect(site.posted).toEqual([]);
});

test('Spark fills nothing when two sign-in forms are on the page', async ({ page }) => {
  const site = await fixtureSite(page, 'login-two-forms.html');
  const error = await refused(signInOnPage(site.cdp, VALUES));
  expect(error).toMatchObject({ code: 'no_form', message: SIGN_IN_REASONS.manyForms });
  await untouched(page);
});

test('Spark fills nothing when the sign-in form is inside a frame', async ({ page }) => {
  const site = await fixtureSite(page, 'login-frame.html');
  const error = await refused(signInOnPage(site.cdp, VALUES));
  expect(error).toMatchObject({ code: 'no_form', message: SIGN_IN_REASONS.framed });
  const framed = page.frameLocator('iframe');
  await expect(framed.locator('#email')).toHaveValue('old@example.test');
  await expect(framed.locator('#password')).toHaveValue('');
  expect(site.posted).toEqual([]);
});

test('a page that repeats the sign-in does not get it to the agent', async ({ page }) => {
  const site = await fixtureSite(page, 'login-spa.html');
  const logs = await capturePageLogs(site.cdp);
  const filled = new Set<number>();
  const outcome = await signInOnPage(site.cdp, VALUES, { filled: (node) => filled.add(node) });
  expect(outcome).toEqual({ url: `${SITE}/login-spa.html`, steps: 1 });
  await expect(page.getByRole('status')).toHaveText(`Signed in as ${USERNAME}`);
  await expect(page.locator('#password')).toHaveValue(PASSWORD);

  const tree = await readPage(site.cdp, new RefMap(), { mode: 'tree', offset: 0 }, filled);
  const text = await readPage(site.cdp, new RefMap(), { mode: 'text', offset: 0 }, filled);
  expect(tree.text).toMatch(/textbox "Email" \[ref_\d+\] value=\[masked\]/);
  expect(tree.text).toMatch(/textbox "Password" \[ref_\d+\] value=\[masked\]/);
  expect(tree.text).not.toContain(PASSWORD);
  expect(text.text).not.toContain(PASSWORD);

  const consoleLines = logs.console.recent(undefined, 50).map((entry) => entry.text);
  expect(consoleLines.join('\n')).toContain(PASSWORD);
  const network = logs.network.recent(undefined, 50).map((entry) => entry.text);
  expect(network.join('\n')).not.toContain(PASSWORD);

  const hidden = scrubberFor([VALUES])!;
  const shown = [tree.text, text.text, await page.title(), ...consoleLines, ...network]
    .map(hidden)
    .join('\n');
  expect(shown).not.toContain(PASSWORD);
  expect(shown).not.toContain(USERNAME);
  expect(shown).toContain('Signed in as [saved sign-in]');
});
