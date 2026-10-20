import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserHostRequest } from '@spark-outpost/contracts';
import { runBrowserOp } from './agent-ops.ts';
import { net, type FakeContents } from './electron.fixture.ts';
import { BrowserPanes } from './panes.ts';
import { answerFor, axOf, el, text, type El, type FakeDocument } from './ref-page.fixture.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const LOCAL = 'http://localhost:5173/';
const home = { projectId: null, keepSignIns: false, roots: [] };
const signal = new AbortController().signal;
const where = { chatId: CHAT, runId: null, tab: undefined };

function list(shift: number, names: string[]): FakeDocument {
  const rows: El[] = names.map((name, index) =>
    el(100 + shift + index * 10, 'listitem', '', {
      tag: 'LI',
      kids: [
        text(101 + shift + index * 10, name),
        el(102 + shift + index * 10, 'button', 'Done', {
          tag: 'BUTTON',
          attrs: ['type', 'button'],
        }),
      ],
    }),
  );
  return {
    documentId: 9000,
    body: el(1, 'RootWebArea', 'Tasks', {
      tag: 'HTML',
      kids: [
        el(10 + shift, 'list', 'Tasks', { tag: 'UL', kids: rows }),
        el(20 + shift, 'form', 'Add', {
          tag: 'FORM',
          kids: [el(21 + shift, 'button', 'Add task', { tag: 'BUTTON' })],
        }),
      ],
    }),
  };
}

let shown = list(0, ['Write', 'Test']);
let panes: BrowserPanes;

const BOX = [0, 0, 20, 0, 20, 10, 0, 10];
const UNDER_THE_POINTER: Record<string, unknown> = {
  'DOM.getBoxModel': { model: { border: BOX } },
  'DOM.getContentQuads': { quads: [BOX] },
  'Page.getFrameTree': { frameTree: { frame: { id: 'main' } } },
  'Page.createIsolatedWorld': { executionContextId: 9 },
  'DOM.resolveNode': { object: { objectId: 'handle' } },
  'Runtime.callFunctionOn': { result: { value: { state: 'clear', index: 0 } } },
};

function answer(method: string, params: Record<string, unknown>): unknown {
  const node = axOf(shown).find((each) => each.backendDOMNodeId === params.backendNodeId);
  if (method === 'Accessibility.getPartialAXTree') {
    const focused = [{ name: 'focused', value: { value: true } }];
    return { nodes: node ? [{ ...node, properties: focused }] : [] };
  }
  if (method === 'DOM.describeNode') {
    return { node: { backendNodeId: params.backendNodeId, nodeName: 'BUTTON' } };
  }
  return UNDER_THE_POINTER[method] ?? answerFor(() => shown)(method);
}

beforeEach(() => {
  net.reset();
  net.answer = answer;
  shown = list(0, ['Write', 'Test']);
  panes = new BrowserPanes({
    window: () => null,
    blockedPorts: () => new Set(),
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

function op<T>(request: BrowserHostRequest): Promise<T> {
  return runBrowserOp(panes, request, signal) as Promise<T>;
}

async function openAndRead(): Promise<{ tabId: string; text: string }> {
  await op({ op: 'open', ...where, url: LOCAL, ...home });
  return op({ op: 'read', ...where, mode: 'tree', offset: 0 });
}

function refBeside(outline: string, words: string, role: string): string {
  const lines = outline.split('\n');
  const at = lines.findIndex((line) => line.includes(words));
  return /\[(ref_\d+)\]/.exec(lines.slice(at).find((line) => line.includes(role))!)![1]!;
}

interface PageAnswer {
  target: { role: string; name: string };
  node: number;
  epoch: number;
  refound?: boolean;
}

describe('acting with a ref after the page re-rendered', () => {
  it('finds the replaced button again, shows it on the card and acts on that node', async () => {
    const read = await openAndRead();
    const done = refBeside(read.text, 'Test', 'button "Done"');
    shown = list(500, ['Test', 'Write']);
    const checked = await op<PageAnswer>({ op: 'page', ...where, ref: done, action: 'type' });
    expect(checked).toMatchObject({ target: { role: 'button', name: 'Done' }, refound: true });
    expect(checked.node).toBe(602);
    const acted = await op<{ target: { name: string } }>({
      op: 'act',
      ...where,
      tab: read.tabId,
      action: 'type',
      ref: done,
      text: 'x',
      origin: 'http://localhost:5173',
      node: checked.node,
      epoch: checked.epoch,
    });
    expect(acted.target.name).toBe('Done');
  });

  it('acts on nothing when the element changed after the card was shown', async () => {
    const read = await openAndRead();
    const done = refBeside(read.text, 'Write', 'button "Done"');
    const checked = await op<PageAnswer>({ op: 'page', ...where, ref: done, action: 'scroll' });
    const act = (node: number, epoch: number) =>
      op({
        op: 'act',
        ...where,
        tab: read.tabId,
        action: 'scroll',
        ref: done,
        origin: 'http://localhost:5173',
        node,
        epoch,
      });
    await expect(act(checked.node + 1, checked.epoch)).rejects.toMatchObject({
      code: 'page_changed',
    });
    await expect(act(checked.node, checked.epoch + 1)).rejects.toMatchObject({
      code: 'page_changed',
    });
    shown = list(500, ['Write', 'Test']);
    await expect(act(checked.node, checked.epoch)).rejects.toMatchObject({
      code: 'no_ref',
      message: /is gone/,
    });
  });

  it('refuses to look again for a button that submits a form', async () => {
    const read = await openAndRead();
    const add = refBeside(read.text, 'Add task', 'button');
    shown = list(500, ['Write', 'Test']);
    await expect(op({ op: 'page', ...where, ref: add, action: 'click' })).rejects.toMatchObject({
      code: 'no_ref',
      message: /does not look again/,
    });
  });

  it('rejects a ref from before the tab navigated', async () => {
    const read = await openAndRead();
    const done = refBeside(read.text, 'Write', 'button "Done"');
    (panes.tab(CHAT, read.tabId)!.view()!.webContents as unknown as FakeContents).followLink(
      'http://localhost:5173/next',
    );
    await expect(op({ op: 'page', ...where, ref: done, action: 'click' })).rejects.toMatchObject({
      code: 'no_ref',
      message: /from an earlier page/,
    });
  });
});
