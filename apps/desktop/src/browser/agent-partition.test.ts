import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runBrowserOp } from './agent-ops.ts';
import { net, type FakeContents } from './electron.fixture.ts';
import { BrowserPanes } from './panes.ts';
import { agentPartition, projectPartition } from './request-guard.ts';
import { loginDom } from './sign-in-dom.fixture.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const API_PORT = 32682;
const USER = projectPartition(PROJECT);
const AGENT = agentPartition(CHAT);
const SITE = 'https://docs.example.com';
const LOCAL = 'http://localhost:5173/';
const home = { projectId: PROJECT, keepSignIns: true, roots: ['/Users/me/app'] };
const signal = new AbortController().signal;

let panes: BrowserPanes;

beforeEach(() => {
  net.reset();
  panes = new BrowserPanes({
    window: () => null,
    blockedPorts: () => new Set([API_PORT]),
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

const settled = () => new Promise((resolve) => setImmediate(resolve));

function agentOpens(url: string) {
  return runBrowserOp(
    panes,
    { op: 'open', chatId: CHAT, runId: null, url, tab: undefined, ...home },
    signal,
  ) as Promise<{ tabId: string; url: string }>;
}

async function userOpens(url: string) {
  const tab = panes.createTab(CHAT, { owner: 'user', runId: null, url: 'about:blank' }, home)!;
  await tab.load(url);
  return tab;
}

function partitionOf(tabId: string): string {
  const contents = panes.tab(CHAT, tabId)!.view()!.webContents as unknown as FakeContents;
  return contents.session.partition;
}

function contentsOf(tabId: string): FakeContents {
  return panes.tab(CHAT, tabId)!.view()!.webContents as unknown as FakeContents;
}

function signedInAsUser(host: string) {
  net.sessions.get(USER)!.cookies.set(host, 'user-session');
}

describe('where an agent tab keeps its cookies', () => {
  it('opens a site in the agent’s own storage, signed out where the user is signed in', async () => {
    const mine = await userOpens(`${SITE}/account`);
    signedInAsUser('docs.example.com');
    const opened = await agentOpens(`${SITE}/guide`);
    expect(partitionOf(mine.id)).toBe(USER);
    expect(partitionOf(opened.tabId)).toBe(AGENT);
    expect(net.requests.at(-1)).toEqual({ partition: AGENT, url: `${SITE}/guide`, cookie: null });
  });

  it('opens a local page in the user’s storage, as before', async () => {
    await userOpens(LOCAL);
    signedInAsUser('localhost:5173');
    const opened = await agentOpens(`${LOCAL}settings`);
    expect(partitionOf(opened.tabId)).toBe(USER);
    expect(net.requests.at(-1)!.cookie).toBe('user-session');
  });

  it('moves to its own storage when a local page links or redirects to a site', async () => {
    await userOpens(`${SITE}/account`);
    signedInAsUser('docs.example.com');
    const opened = await agentOpens(LOCAL);
    contentsOf(opened.tabId).followLink(`${SITE}/guide`);
    await settled();
    expect(partitionOf(opened.tabId)).toBe(AGENT);
    expect(panes.tab(CHAT, opened.tabId)!.currentUrl()).toBe(`${SITE}/guide`);

    net.redirects.set(`${LOCAL}out`, `${SITE}/landing`);
    const second = await agentOpens(`${LOCAL}out`);
    await settled();
    expect(partitionOf(second.tabId)).toBe(AGENT);
    const toSite = net.requests.filter((request) => request.url.startsWith(SITE));
    expect(toSite.filter((request) => request.partition === USER).map((r) => r.url)).toEqual([
      `${SITE}/account`,
    ]);
    expect(toSite.every((r) => r.partition === USER || r.cookie === null)).toBe(true);
  });

  it('moves back to the user’s storage when a site leads to a local page', async () => {
    const opened = await agentOpens(`${SITE}/guide`);
    contentsOf(opened.tabId).followLink(LOCAL);
    await settled();
    expect(partitionOf(opened.tabId)).toBe(USER);
  });

  it('keeps a tab the agent opens from a link in the agent’s storage, as an agent tab', async () => {
    const opened = await agentOpens(`${SITE}/guide`);
    expect(contentsOf(opened.tabId).windowOpen('https://other.example.org/page')).toBe('deny');
    await settled();
    const popup = panes.tabsOf(CHAT).find((tab) => tab.id !== opened.tabId)!;
    expect(popup.owner).toBe('agent');
    expect(partitionOf(popup.id)).toBe(AGENT);
  });

  it('gives the tab the user’s storage once the user navigates it', async () => {
    const opened = await agentOpens(`${SITE}/guide`);
    const tab = panes.tab(CHAT, opened.tabId)!;
    tab.owner = 'user';
    await tab.load(`${SITE}/account`);
    expect(partitionOf(tab.id)).toBe(USER);
    expect(net.liveViews()).toHaveLength(1);
  });

  it('leaves a tab the user owns in the user’s storage when the agent acts on it', async () => {
    const mine = await userOpens(`${SITE}/account`);
    net.answer = (method) =>
      method === 'Page.getLayoutMetrics'
        ? { cssVisualViewport: { clientWidth: 800, clientHeight: 600 } }
        : {};
    await runBrowserOp(
      panes,
      { op: 'act', chatId: CHAT, runId: null, tab: mine.id, action: 'scroll', origin: SITE },
      signal,
    );
    expect(partitionOf(mine.id)).toBe(USER);
    expect(mine.owner).toBe('user');
  });

  it('keeps one chat’s agent storage from another chat', () => {
    const other = '99999999-2222-4333-8444-555555555555';
    expect(agentPartition(other)).not.toBe(AGENT);
    expect(AGENT.startsWith('persist:')).toBe(false);
  });
});

describe('a saved sign-in typed into an agent tab', () => {
  it('signs the agent’s storage in and leaves the user’s storage alone', async () => {
    const opened = await agentOpens(`${SITE}/login`);
    const login = loginDom();
    const typed: { partition: string; text: string }[] = [];
    let focused = 0;
    net.answer = (method, params, url) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { url } } };
      if (method === 'DOM.getDocument') return { root: login.root };
      if (method === 'DOM.getBoxModel') return { model: { border: [0, 0, 9, 0, 9, 9, 0, 9] } };
      if (method === 'DOM.focus') focused = Number(params.backendNodeId);
      if (method === 'Accessibility.getPartialAXTree') {
        const node = Number(params.backendNodeId);
        return {
          nodes: [
            {
              nodeId: '1',
              backendDOMNodeId: node,
              properties: [{ name: 'focused', value: { value: focused === node } }],
            },
          ],
        };
      }
      if (method === 'Input.insertText') {
        typed.push({ partition: partitionOf(opened.tabId), text: String(params.text) });
      }
      return {};
    };
    const done = (await runBrowserOp(
      panes,
      {
        op: 'sign_in',
        chatId: CHAT,
        runId: null,
        tab: opened.tabId,
        sites: [SITE],
        username: 'vault-user@example.test',
        password: 'vault-Passw0rd!-unit',
      },
      signal,
    )) as { steps: number };
    expect(done.steps).toBe(1);
    expect(typed).toEqual([
      { partition: AGENT, text: 'vault-user@example.test' },
      { partition: AGENT, text: 'vault-Passw0rd!-unit' },
    ]);
    expect(panes.tab(CHAT, opened.tabId)!.filled.size).toBe(2);
    expect(net.sessions.get(USER)).toBeUndefined();
  }, 15_000);
});

describe('the guards on the agent’s storage', () => {
  it('blocks Spark’s ports, denies permissions, cancels downloads and strips the token', async () => {
    await agentOpens(`${SITE}/guide`);
    const session = net.sessions.get(AGENT)!;
    expect(session.requestCancelled(`http://127.0.0.1:${API_PORT}/api/health`)).toBe(true);
    expect(session.requestCancelled(`ws://rebind.example.com:${API_PORT}/`)).toBe(true);
    expect(session.requestCancelled('file:///Users/me/app/index.html')).toBe(true);
    expect(session.requestCancelled(`${SITE}/app.js`)).toBe(false);
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
      expect(session.permissionGranted(permission), permission).toBe(false);
    }
    expect(session.downloadCancelled()).toBe(true);
    expect(session.headersSent(`${SITE}/x`, { Accept: '*/*', 'X-Spark-Token': 'guess' })).toEqual({
      Accept: '*/*',
    });
  });
});

describe('a site that sends an agent tab somewhere it may not go', () => {
  it('fails to load when it redirects to one of Spark’s own ports, and that port gets no request', async () => {
    net.redirects.set(`${SITE}/go`, `http://127.0.0.1:${API_PORT}/api/conversations`);
    const opening = agentOpens(`${SITE}/go`);
    await expect(opening).rejects.toMatchObject({ code: 'load_failed' });
    await settled();
    expect(net.requests.map((request) => request.url)).toEqual([`${SITE}/go`]);
    const tab = panes.tabsOf(CHAT)[0]!;
    expect(tab.currentUrl()).not.toContain(String(API_PORT));
    expect(tab.error).not.toBeNull();
  });

  it('fails the same way through a rebinding host name and a second hop', async () => {
    net.redirects.set(`${SITE}/a`, 'https://hop.example.net/b');
    net.redirects.set('https://hop.example.net/b', `https://rebind.example.com:${API_PORT}/`);
    await expect(agentOpens(`${SITE}/a`)).rejects.toMatchObject({ code: 'load_failed' });
    expect(net.requests.map((request) => request.url)).toEqual([
      `${SITE}/a`,
      'https://hop.example.net/b',
    ]);
  });

  it.each(['data:text/html,<script>1</script>', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'stops a redirect to %s',
    async (target) => {
      net.redirects.set(`${SITE}/go`, target);
      await expect(agentOpens(`${SITE}/go`)).rejects.toMatchObject({ code: 'load_failed' });
      expect(net.requests.map((request) => request.url)).toEqual([`${SITE}/go`]);
    },
  );

  it('stops a link or script that points at Spark’s port or a script address', async () => {
    const opened = await agentOpens(`${SITE}/guide`);
    const contents = contentsOf(opened.tabId);
    for (const target of [
      `http://localhost:${API_PORT}/api/health`,
      'javascript:alert(1)',
      'data:text/html,x',
    ]) {
      contents.followLink(target);
      await settled();
      expect(panes.tab(CHAT, opened.tabId)!.currentUrl(), target).toBe(`${SITE}/guide`);
    }
    expect(panes.tab(CHAT, opened.tabId)!.error).not.toBeNull();
    contents.emit('did-start-loading');
    contents.followLink('javascript:void(0)');
    expect(panes.tab(CHAT, opened.tabId)!.error).toBeNull();
    expect(net.requests.map((request) => request.url)).toEqual([`${SITE}/guide`]);
  });

  it('applies the same to a tab the user owns', async () => {
    net.redirects.set(`${SITE}/go`, `http://127.0.0.1:${API_PORT}/`);
    const mine = await userOpens(`${SITE}/go`);
    expect(mine.error).not.toBeNull();
    expect(net.requests.map((request) => request.url)).toEqual([`${SITE}/go`]);
  });
});
