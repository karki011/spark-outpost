import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import {
  bakedSignInEnv,
  deliverSlackCallback,
  isSlackCallback,
  readBakedSlackClientId,
  slackClientId,
} from './slack-sign-in.ts';

let dir = '';

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function manifest(content: object): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-slack-app-'));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(content));
  return dir;
}

describe('the Slack client ID baked into a build', () => {
  it('hands the client ID to the server beside the GitHub App ids', async () => {
    const appPath = await manifest({
      slackApp: { clientId: '1234567890.9876543210' },
      githubApp: { clientId: 'Iv23liExample', slug: 'spark' },
    });

    expect(await bakedSignInEnv(appPath)).toEqual({
      SPARK_GITHUB_APP_CLIENT_ID: 'Iv23liExample',
      SPARK_GITHUB_APP_SLUG: 'spark',
      SPARK_SLACK_CLIENT_ID: '1234567890.9876543210',
    });
  });

  it('gives nothing when the build has none or the value is not a client ID', async () => {
    expect(await readBakedSlackClientId(await manifest({}))).toBeNull();
    expect(await bakedSignInEnv(dir)).toEqual({});
    expect(slackClientId('0123456789abcdef0123456789abcdef')).toBeNull();
    expect(slackClientId('xoxb-1234567890-abcdefghij')).toBeNull();
    expect(slackClientId(12)).toBeNull();
  });
});

describe('the Slack sign-in link', () => {
  const api = { origin: 'http://127.0.0.1:4310', token: 'launch-token' };
  const link = 'spark-outpost://slack/callback?code=abc&state=xyz';

  it('is told apart from a chat link and from another scheme', () => {
    expect(isSlackCallback(link, 'spark-outpost')).toBe(true);
    expect(isSlackCallback(link, 'spark-outpost-dev')).toBe(false);
    expect(isSlackCallback('spark-outpost://chat/123', 'spark-outpost')).toBe(false);
  });

  it('is handed to the local API with the launch token and nowhere else', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));

    expect(await deliverSlackCallback(api, link, fetchImpl)).toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [target, init] = fetchImpl.mock.calls[0]!;
    expect(target).toBe('http://127.0.0.1:4310/api/slack/sign-in/callback');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ [API_TOKEN_HEADER]: 'launch-token' });
    expect(JSON.parse(init?.body as string)).toEqual({ url: link });
  });

  it('reports a refused or unreachable hand-over instead of throwing', async () => {
    const refused = vi.fn<typeof fetch>(async () => new Response('{}', { status: 400 }));
    const down = vi.fn<typeof fetch>(async () => Promise.reject(new Error('down')));

    expect(await deliverSlackCallback(api, link, refused)).toBe(false);
    expect(await deliverSlackCallback(api, link, down)).toBe(false);
  });
});
