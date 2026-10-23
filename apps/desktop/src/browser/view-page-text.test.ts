import { beforeEach, describe, expect, it, vi } from 'vitest';
import { net, type FakeContents } from './electron.fixture.ts';
import { invoke, startTestBrowser } from './view-host.fixture.ts';
import { readViewPageText } from './view-page-text.ts';

vi.mock('electron', async () => (await import('./electron-ipc.fixture.ts')).fakeElectronWithIpc);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const DOCS = 'https://docs.example.com/deploying';

const TREE = {
  nodes: [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Docs' }, childIds: ['2'] },
    {
      nodeId: '2',
      parentId: '1',
      role: { value: 'StaticText' },
      name: { value: 'Promote with acme deploy --prod. key=AKIAABCDEFGHIJKLMNOP' },
    },
  ],
};

beforeEach(() => {
  net.reset();
  net.answer = (method) => {
    if (method === 'Accessibility.getFullAXTree') return TREE;
    if (method === 'DOM.getDocument') {
      return { root: { backendNodeId: 1, nodeName: 'HTML', children: [] } };
    }
    return {};
  };
});

describe('page text the user attaches from the Browser view', () => {
  it('reads the page’s text with secret-looking values redacted', async () => {
    const { view } = startTestBrowser();
    await invoke('browser-view:start', 'personal');
    const [tab] = view.panes.tabsOf('personal');
    await invoke('browser-view:command', 'personal', {
      command: 'navigate',
      tabId: tab!.id,
      url: DOCS,
    });
    const page = await readViewPageText(view.panes, 'personal', tab!.id);
    expect(page.url).toBe(DOCS);
    expect(page.text).toContain('acme deploy --prod');
    expect(page.text).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });

  it('refuses a blank tab and a tab of another profile', async () => {
    const { view } = startTestBrowser();
    await invoke('browser-view:start', 'work');
    const [tab] = view.panes.tabsOf('work');
    await expect(readViewPageText(view.panes, 'work', tab!.id)).rejects.toThrow(
      'That tab has no page to read.',
    );
    await expect(readViewPageText(view.panes, 'personal', tab!.id)).rejects.toThrow(
      'That tab has no page to read.',
    );
  });
});
