import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserHostRequestSchema,
  type BrowserHostOp,
  type BrowserHostRequest,
} from '@spark-outpost/contracts';
import { runBrowserOp } from './agent-ops.ts';
import { net, type FakeContents } from './electron.fixture.ts';
import type { BrowserPanes } from './panes.ts';
import { BROWSER_PARTITION, PERSONAL_PARTITION } from './request-guard.ts';
import type { PaneTab } from './tab.ts';
import type { BrowserViewHost } from './view-host.ts';
import { invoke, startTestBrowser } from './view-host.fixture.ts';

vi.mock('electron', async () => (await import('./electron-ipc.fixture.ts')).fakeElectronWithIpc);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const RUN = '22222222-3333-4444-8555-666666666666';
const BANK = 'https://bank.example.com/account';
const signal = new AbortController().signal;

let chats: BrowserPanes;
let view: BrowserViewHost;
let bankPageTouched: string[];

beforeEach(() => {
  net.reset();
  bankPageTouched = [];
  net.answer = (method, _params, url) => {
    if (url === BANK) bankPageTouched.push(method);
    return {};
  };
  ({ chats, view } = startTestBrowser());
});

async function personalTab(): Promise<PaneTab> {
  await invoke('browser-view:start', 'personal');
  const [tab] = view.panes.tabsOf('personal');
  await invoke('browser-view:command', 'personal', {
    command: 'navigate',
    tabId: tab!.id,
    url: BANK,
  });
  bankPageTouched = [];
  return tab!;
}

const REQUESTS: Record<BrowserHostOp, (tab: string) => BrowserHostRequest> = {
  open: (tab) => ({
    op: 'open',
    chatId: CHAT,
    runId: RUN,
    url: BANK,
    tab,
    projectId: null,
    roots: [],
  }),
  tabs: () => ({ op: 'tabs', chatId: CHAT, runId: RUN }),
  read: (tab) => ({ op: 'read', chatId: CHAT, runId: RUN, tab, mode: 'text', offset: 0 }),
  screenshot: (tab) => ({ op: 'screenshot', chatId: CHAT, runId: RUN, tab, fullPage: false }),
  logs: (tab) => ({ op: 'logs', chatId: CHAT, runId: RUN, tab, kind: 'console', limit: 50 }),
  end_run: () => ({ op: 'end_run', chatId: CHAT, runId: RUN }),
  page: (tab) => ({ op: 'page', chatId: CHAT, runId: RUN, tab, settle: true }),
  keep: (tab) => ({ op: 'keep', chatId: CHAT, runId: RUN, tab }),
  evaluate: (tab) => ({
    op: 'evaluate',
    chatId: CHAT,
    runId: RUN,
    tab,
    expression: 'document.cookie',
    origin: 'https://bank.example.com',
  }),
  inspect: (tab) => ({ op: 'inspect', chatId: CHAT, runId: RUN, tab, selector: 'body' }),
  performance: (tab) => ({ op: 'performance', chatId: CHAT, runId: RUN, tab }),
  storage: (tab) => ({ op: 'storage', chatId: CHAT, runId: RUN, tab, values: true }),
  hand_over: (tab) => ({
    op: 'hand_over',
    chatId: CHAT,
    runId: RUN,
    tab,
    handoff: {
      agent: 'Claude',
      site: 'https://bank.example.com',
      approvalId: '33333333-4444-4555-8666-777777777777',
    },
  }),
  act: (tab) => ({
    op: 'act',
    chatId: CHAT,
    runId: RUN,
    tab,
    action: 'click',
    ref: 'ref_1',
    origin: 'https://bank.example.com',
  }),
  sign_in: (tab) => ({
    op: 'sign_in',
    chatId: CHAT,
    runId: RUN,
    tab,
    sites: ['https://bank.example.com'],
    username: 'someone',
    password: 'not-a-real-password',
  }),
};

const OPS = browserHostRequestSchema.options.map((option) => option.shape.op.value);

describe('the Personal profile', () => {
  it('names every agent browser request in this test', () => {
    expect(Object.keys(REQUESTS).sort()).toEqual([...OPS].sort());
  });

  it('keeps Personal tabs on their own partition, apart from every chat', async () => {
    const tab = await personalTab();
    const contents = tab.view()!.webContents as unknown as FakeContents;
    expect(contents.session.partition).toBe(PERSONAL_PARTITION);
    expect(chats.tabsOf(CHAT)).toEqual([]);
    expect(chats.tabOfContents(contents as never)).toBeNull();
  });

  it.each(OPS)('gives an agent no way in through %s', async (op) => {
    const tab = await personalTab();
    const request = browserHostRequestSchema.parse(REQUESTS[op](tab.id));
    const outcome = await runBrowserOp(chats, request, signal).then(
      (result) => ({ result, code: null }),
      (error: { code?: string }) => ({ result: null, code: error.code ?? 'thrown' }),
    );

    expect(bankPageTouched).toEqual([]);
    expect(tab.owner).toBe('user');
    expect(tab.kept).toBe(false);
    expect(tab.handoff).toBeNull();
    expect(tab.lastAction).toBeNull();
    expect(tab.agentBusy).toBe(0);
    expect(view.panes.tabsOf('personal')).toEqual([tab]);
    expect(JSON.stringify(outcome.result ?? '')).not.toContain(tab.id);
    if (op === 'open') {
      const opened = chats.tabsOf(CHAT);
      expect(opened).toHaveLength(1);
      const contents = opened[0]!.view()!.webContents as unknown as FakeContents;
      expect(contents.session.partition).toBe(BROWSER_PARTITION);
    } else if (op === 'tabs') {
      expect(outcome.result).toEqual({ tabs: [] });
    } else if (op === 'keep') {
      expect(outcome.result).toEqual({ kept: false });
    } else if (op === 'end_run') {
      expect(outcome.result).toEqual({ closed: 0 });
    } else {
      expect(outcome.code).toBe('no_tab');
    }
  });

  it('keeps a Peek of a Personal tab from every agent request', async () => {
    const tab = await personalTab();
    (tab.contents() as unknown as FakeContents).emit(
      'before-mouse-event',
      {},
      { type: 'mouseDown' },
    );
    (tab.contents() as unknown as FakeContents).windowOpen(
      'https://bank.example.com/peek',
      'new-window',
    );
    const peek = view.panes.tabsOf('personal').find((candidate) => candidate.peek)!;
    expect(peek).toBeDefined();
    for (const op of ['read', 'screenshot', 'logs', 'evaluate'] as const) {
      await expect(runBrowserOp(chats, REQUESTS[op](peek.id), signal)).rejects.toMatchObject({
        code: 'no_tab',
      });
    }
    expect(chats.tabsOf(CHAT).some((candidate) => candidate.id === peek.id)).toBe(false);
  });

  it('refuses a request that names a profile instead of a chat', () => {
    for (const chatId of ['personal', 'work']) {
      expect(browserHostRequestSchema.safeParse({ op: 'tabs', chatId, runId: null }).success).toBe(
        false,
      );
    }
  });

  it('keeps the Personal sign-in out of the Work profile an agent uses', async () => {
    const tab = await personalTab();
    const contents = tab.view()!.webContents as unknown as FakeContents;
    contents.session.cookies.set('bank.example.com', 'personal-session');
    await runBrowserOp(chats, REQUESTS.open(tab.id), signal);
    const agentVisit = net.requests.filter((request) => request.partition === BROWSER_PARTITION);
    expect(agentVisit).toEqual([{ partition: BROWSER_PARTITION, url: BANK, cookie: null }]);
  });

  it('puts every kept block on the Personal session', async () => {
    const tab = await personalTab();
    const contents = tab.view()!.webContents as unknown as FakeContents;
    const personal = contents.session;
    expect(personal.requestCancelled('http://127.0.0.1:32682/api/health', contents)).toBe(true);
    expect(personal.requestCancelled('file:///Users/me/app/index.html', contents)).toBe(true);
    expect(personal.headersSent(BANK, { 'X-Spark-Token': 'abc' })).toEqual({});
    expect(personal.permissionGranted('media', contents)).toBe(false);
    expect(personal.permissionGranted('notifications', contents)).toBe(false);
    expect(personal.downloadCancelled()).toBe(true);
    expect(personal.preloads).toHaveLength(2);
  });

  it('keeps Work Browser view tabs out of every chat too', async () => {
    await invoke('browser-view:start', 'work');
    const [tab] = view.panes.tabsOf('work');
    await invoke('browser-view:command', 'work', {
      command: 'navigate',
      tabId: tab!.id,
      url: BANK,
    });
    const contents = tab!.view()!.webContents as unknown as FakeContents;
    expect(contents.session.partition).toBe(BROWSER_PARTITION);
    await expect(runBrowserOp(chats, REQUESTS.read(tab!.id), signal)).rejects.toMatchObject({
      code: 'no_tab',
    });
    expect(await runBrowserOp(chats, REQUESTS.tabs(tab!.id), signal)).toEqual({ tabs: [] });
    expect(contents.session.requestCancelled('file:///Users/me/app/index.html', contents)).toBe(
      true,
    );
  });
});
