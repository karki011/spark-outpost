import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runBrowserOp } from './agent-ops.ts';
import { net, type FakeContents } from './electron.fixture.ts';
import { BrowserPanes } from './panes.ts';
import { BROWSER_PARTITION } from './request-guard.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT_A = '11111111-2222-4333-8444-555555555555';
const CHAT_B = '22222222-3333-4444-8555-666666666666';
const CHAT_C = '33333333-4444-4555-8666-777777777777';
const PROJECT_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PROJECT_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const homeA = { projectId: PROJECT_A, roots: ['/Users/me/app-a'] };
const homeB = { projectId: PROJECT_B, roots: ['/Users/me/app-b'] };
const noProject = { projectId: null, roots: [] };
const SITE = 'https://docs.example.com';
const signal = new AbortController().signal;

let panes: BrowserPanes;

beforeEach(() => {
  net.reset();
  panes = new BrowserPanes({
    window: () => null,
    blockedPorts: () => new Set([32682]),
    stateChanged: () => undefined,
    snapshot: () => undefined,
    localOriginSeen: () => undefined,
    contextMenu: () => undefined,
    addShortcut: () => undefined,
    paneShortcut: () => undefined,
    found: () => undefined,
    log: () => undefined,
  });
});

async function agentOpens(chatId: string, home: typeof homeA | typeof noProject, url: string) {
  const opened = (await runBrowserOp(
    panes,
    { op: 'open', chatId, runId: null, url, tab: undefined, ...home },
    signal,
  )) as { tabId: string };
  return panes.tab(chatId, opened.tabId)!.view()!.webContents as unknown as FakeContents;
}

async function userOpens(chatId: string, home: typeof homeA | typeof noProject, url: string) {
  const tab = panes.createTab(chatId, { owner: 'user', runId: null, url: 'about:blank' }, home)!;
  await tab.load(url);
  return tab.view()!.webContents as unknown as FakeContents;
}

describe('one Browser pane profile for every chat', () => {
  it('carries a sign-in made in chat A to chat B in another project and to a chat with no project', async () => {
    const mine = await userOpens(CHAT_A, homeA, `${SITE}/login`);
    mine.session.cookies.set('docs.example.com', 'signed-in-in-a');

    const inB = await agentOpens(CHAT_B, homeB, `${SITE}/guide`);
    const inC = await agentOpens(CHAT_C, noProject, `${SITE}/account`);
    const userInC = await userOpens(CHAT_C, noProject, `${SITE}/settings`);

    for (const contents of [mine, inB, inC, userInC]) {
      expect(contents.session.partition).toBe(BROWSER_PARTITION);
    }
    expect([...net.sessions.keys()]).toEqual([BROWSER_PARTITION]);
    expect(net.requests.slice(1)).toEqual([
      { partition: BROWSER_PARTITION, url: `${SITE}/guide`, cookie: 'signed-in-in-a' },
      { partition: BROWSER_PARTITION, url: `${SITE}/account`, cookie: 'signed-in-in-a' },
      { partition: BROWSER_PARTITION, url: `${SITE}/settings`, cookie: 'signed-in-in-a' },
    ]);
  });

  it('still lets each chat load only its own project files', async () => {
    const inA = await agentOpens(CHAT_A, homeA, `${SITE}/a`);
    const inB = await agentOpens(CHAT_B, homeB, `${SITE}/b`);
    const inC = await agentOpens(CHAT_C, noProject, `${SITE}/c`);
    const session = inA.session;
    expect(inB.session).toBe(session);

    expect(session.requestCancelled('file:///Users/me/app-a/index.html', inA)).toBe(false);
    expect(session.requestCancelled('file:///Users/me/app-b/index.html', inA)).toBe(true);
    expect(session.requestCancelled('file:///Users/me/app-b/index.html', inB)).toBe(false);
    expect(session.requestCancelled('file:///Users/me/app-a/index.html', inB)).toBe(true);
    expect(session.requestCancelled('file:///Users/me/app-a/index.html', inC)).toBe(true);
    expect(session.requestCancelled('file:///Users/me/app-a/index.html')).toBe(true);
  });

  it('refuses another project’s file when an agent in chat A opens it', async () => {
    await agentOpens(CHAT_B, homeB, `${SITE}/b`);
    await expect(
      runBrowserOp(
        panes,
        {
          op: 'open',
          chatId: CHAT_A,
          runId: null,
          url: 'file:///Users/me/app-b/secret.html',
          tab: undefined,
          ...homeA,
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'not_allowed' });
  });

  it('stops loading a folder the chat no longer links', async () => {
    const inA = await agentOpens(CHAT_A, homeA, `${SITE}/a`);
    const both = { projectId: PROJECT_A, roots: ['/Users/me/app-a', '/Users/me/wt-a'] };
    panes.touch(CHAT_A, both);
    expect(inA.session.requestCancelled('file:///Users/me/wt-a/index.html', inA)).toBe(false);

    panes.touch(CHAT_A, homeA);
    expect(panes.guardFacts(CHAT_A).roots).toEqual(['/Users/me/app-a']);
    expect(inA.session.requestCancelled('file:///Users/me/wt-a/index.html', inA)).toBe(true);
    expect(inA.session.requestCancelled('file:///Users/me/app-a/index.html', inA)).toBe(false);
  });

  it('forgets a removed chat’s project files', async () => {
    const inA = await agentOpens(CHAT_A, homeA, `${SITE}/a`);
    const keep = await agentOpens(CHAT_B, homeB, `${SITE}/b`);
    panes.forget(CHAT_A);
    expect(panes.guardFacts(CHAT_A).roots).toEqual([]);
    expect(keep.session.requestCancelled('file:///Users/me/app-a/x.html', inA)).toBe(true);
  });
});
