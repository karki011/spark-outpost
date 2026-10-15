import { describe, expect, it } from 'vitest';
import type { BrowserPaneTab } from '@spark-outpost/contracts';
import { agentOpenedTab, type ChatBrowser } from './browser-store.ts';

function tab(id: string, change: Partial<BrowserPaneTab> = {}): BrowserPaneTab {
  return {
    id,
    title: id,
    url: `http://localhost:5173/${id}`,
    owner: 'user',
    active: false,
    place: 'local',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    pinned: false,
    driving: false,
    picking: false,
    lastAction: null,
    error: null,
    ...change,
  };
}

const chat = (tabs: BrowserPaneTab[], agentOpened: string | null = null): ChatBrowser => ({
  tabs,
  snapshot: null,
  agentOpened,
  notice: null,
});

describe('noticing that the agent opened a page', () => {
  const agent = tab('a1', { owner: 'agent', driving: true });

  it('notices a new agent tab in a chat whose pane was never opened', () => {
    expect(agentOpenedTab(chat([]), [agent])).toBe('a1');
    expect(agentOpenedTab(chat([tab('u1')]), [tab('u1'), agent])).toBe('a1');
  });

  it('ignores tabs the user opened and agent tabs that are not being worked on', () => {
    expect(agentOpenedTab(chat([]), [tab('u1', { loading: true })])).toBeNull();
    expect(agentOpenedTab(chat([]), [tab('a1', { owner: 'agent', pinned: true })])).toBeNull();
  });

  it('does not notice the same tab again when the agent reloads or reads it', () => {
    expect(
      agentOpenedTab(chat([agent]), [{ ...agent, url: 'http://localhost:5173/x' }]),
    ).toBeNull();
  });

  it('keeps the notice while the tab is open and drops it when the tab closes', () => {
    expect(agentOpenedTab(chat([agent], 'a1'), [{ ...agent, driving: false }])).toBe('a1');
    expect(agentOpenedTab(chat([agent], 'a1'), [tab('u1')])).toBeNull();
  });
});
