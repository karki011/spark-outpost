import { describe, expect, it } from 'vitest';
import { chooseOpenTab, type TabFacts } from './tab-rules.ts';

function tab(id: string, url: string, change: Partial<TabFacts> = {}): TabFacts {
  return { id, url, owner: 'agent', active: false, pinned: false, lastUsed: 1, ...change };
}

describe('which tab an agent open uses', () => {
  it('opens a new tab when the chat has none', () => {
    expect(chooseOpenTab([], 'http://localhost:3000/')).toEqual({ action: 'new' });
  });

  it('reuses its own tab already on that page', () => {
    const tabs = [tab('a', 'http://localhost:3000/cart')];
    expect(chooseOpenTab(tabs, 'http://localhost:3000/cart')).toEqual({
      action: 'reuse',
      tabId: 'a',
    });
  });

  it('navigates its own tab when only the query differs', () => {
    const tabs = [tab('a', 'http://localhost:3000/cart?step=1')];
    expect(chooseOpenTab(tabs, 'http://localhost:3000/cart?step=2')).toEqual({
      action: 'navigate',
      tabId: 'a',
    });
  });

  it('navigates its own tab on the same origin', () => {
    const tabs = [tab('a', 'http://localhost:3000/'), tab('b', 'http://localhost:4000/')];
    expect(chooseOpenTab(tabs, 'http://localhost:4000/admin')).toEqual({
      action: 'navigate',
      tabId: 'b',
    });
  });

  it('never navigates a tab the user owns', () => {
    const tabs = [tab('u', 'http://localhost:3000/', { owner: 'user', active: true })];
    expect(chooseOpenTab(tabs, 'http://localhost:3000/admin')).toEqual({ action: 'new' });
    expect(chooseOpenTab(tabs, 'http://localhost:3000/admin', 'u')).toEqual({ action: 'new' });
  });

  it('opens its own tab when the only match is the tab the user is on', () => {
    const tabs = [tab('u', 'http://localhost:3000/', { owner: 'user', active: true })];
    expect(chooseOpenTab(tabs, 'http://localhost:3000/')).toEqual({ action: 'new' });
  });

  it('reads a user tab in the background without navigating it', () => {
    const tabs = [tab('u', 'http://localhost:3000/', { owner: 'user' })];
    expect(chooseOpenTab(tabs, 'http://localhost:3000/')).toEqual({ action: 'reuse', tabId: 'u' });
  });

  it('keeps a pinned tab where it is', () => {
    const tabs = [tab('a', 'http://localhost:3000/', { pinned: true })];
    expect(chooseOpenTab(tabs, 'http://localhost:3000/admin')).toEqual({ action: 'new' });
  });

  it('recycles its oldest unpinned tab at the five-tab cap', () => {
    const tabs = [1, 2, 3, 4, 5].map((n) =>
      tab(`t${n}`, `http://localhost:${3000 + n}/`, { lastUsed: n === 3 ? 0 : n, pinned: n === 1 }),
    );
    expect(chooseOpenTab(tabs, 'http://localhost:9000/')).toEqual({
      action: 'navigate',
      tabId: 't3',
    });
  });

  it('reports the limit when every agent tab is pinned', () => {
    const tabs = [1, 2, 3, 4, 5].map((n) =>
      tab(`t${n}`, `http://localhost:${3000 + n}/`, { pinned: true }),
    );
    expect(chooseOpenTab(tabs, 'http://localhost:9000/')).toEqual({ action: 'limit' });
  });

  it('uses the asked tab when it is the agent’s', () => {
    const tabs = [tab('a', 'http://localhost:3000/'), tab('b', 'http://localhost:4000/')];
    expect(chooseOpenTab(tabs, 'http://localhost:5000/', 'a')).toEqual({
      action: 'navigate',
      tabId: 'a',
    });
  });
});
