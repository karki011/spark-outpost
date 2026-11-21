import { describe, expect, it, vi } from 'vitest';
import { leavesPage } from './leave-site.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);

describe('a page that asks to stay', () => {
  it('asks the user on their own tab and follows the answer', () => {
    expect(leavesPage({ owner: 'user', shown: true, locked: false }, () => true)).toBe(true);
    expect(leavesPage({ owner: 'user', shown: true, locked: false }, () => false)).toBe(false);
  });

  it('never asks for an agent tab, which leaves', () => {
    const ask = vi.fn(() => false);
    expect(leavesPage({ owner: 'agent', shown: false, locked: false }, ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('stays without asking while the privacy screen is locked or the tab is not on screen', () => {
    const ask = vi.fn(() => true);
    expect(leavesPage({ owner: 'user', shown: false, locked: false }, ask)).toBe(false);
    expect(leavesPage({ owner: 'user', shown: true, locked: true }, ask)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
});
