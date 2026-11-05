import type { Page } from '@playwright/test';
import { SLACK_BOT_TOKEN, SLACK_USER_TOKEN } from '../../apps/server/test/fake-slack.ts';
import type { FakeSlackPost } from '../../apps/server/test/fake-slack.ts';
import { STUB_PORT } from './stub-config.ts';

const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

export async function resetSlackFake(): Promise<void> {
  await fetch(`${STUB_URL}/slack-test/reset`);
}

export async function useLegacySlackScopes(): Promise<void> {
  await fetch(`${STUB_URL}/slack-test/legacy-scopes`);
}

export async function slackPosts(): Promise<FakeSlackPost[]> {
  return (await (await fetch(`${STUB_URL}/slack-test/posted`)).json()) as FakeSlackPost[];
}

export interface SlackOAuthSeen {
  access: string | null;
  refresh: string | null;
  requests: Record<string, string>[];
  revoked: string[];
}

export async function slackOAuth(): Promise<SlackOAuthSeen> {
  return (await (await fetch(`${STUB_URL}/slack-test/oauth`)).json()) as SlackOAuthSeen;
}

export async function endSlackSignIn(): Promise<void> {
  await fetch(`${STUB_URL}/slack-test/end-sign-in`);
}

export async function approveInFakeSlack(
  page: Page,
  authorizeUrl: string,
  deny: string | null = null,
): Promise<void> {
  const query = new URLSearchParams({ url: authorizeUrl, ...(deny ? { deny } : {}) });
  const answer = await fetch(`${STUB_URL}/slack-test/authorize?${query.toString()}`);
  const { redirect } = (await answer.json()) as { redirect: string };
  await page.request.post('/api/slack/sign-in/callback', { data: { url: redirect } });
}

export async function connectSlack(page: Page, channels: string[] = ['C0ENG']): Promise<void> {
  await page.request.put('/api/slack/connection', {
    data: { botToken: SLACK_BOT_TOKEN, userToken: SLACK_USER_TOKEN, replace: true },
  });
  await page.request.put('/api/slack/channels', {
    data: { channels: channels.map((id) => ({ id, projectId: null })) },
  });
}

export async function openSlackCard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  const card = page.locator('.cx-card[data-connector="slack"]');
  await card.locator('button.pc-head').click();
  return card;
}
