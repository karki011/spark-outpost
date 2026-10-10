// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Outpost } from '@spark-outpost/contracts';
import { OutpostGroup } from './OutpostGroup.tsx';

afterEach(cleanup);

const outpost: Outpost = {
  id: '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b201',
  name: 'Orders launch',
  pausedAt: null,
  createdAt: '2026-10-09T10:00:00Z',
  updatedAt: '2026-10-09T10:00:00Z',
  members: [],
  needsYou: 0,
};

function renderGroup(options: { open?: boolean; count?: number; needsYou?: number } = {}) {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(
    <ul>
      <OutpostGroup
        outpost={{ ...outpost, needsYou: options.needsYou ?? 0 }}
        current={false}
        open={options.open ?? true}
        count={options.count ?? 2}
        onOpen={onOpen}
        onToggle={onToggle}
      >
        <p>Member rows</p>
      </OutpostGroup>
    </ul>,
  );
  return { onOpen, onToggle };
}

describe('OutpostGroup', () => {
  it('shows its chats when open and names the body its arrow controls', () => {
    renderGroup();
    const fold = screen.getByRole('button', { name: '2 chats in Orders launch' });
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    const body = document.getElementById(fold.getAttribute('aria-controls') ?? '');
    expect(body?.textContent).toBe('Member rows');
    expect(body?.hasAttribute('inert')).toBe(false);
  });

  it('keeps its chats mounted but out of reach when collapsed', () => {
    renderGroup({ open: false });
    const fold = screen.getByRole('button', { name: '2 chats in Orders launch' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    const body = document.getElementById(fold.getAttribute('aria-controls') ?? '');
    expect(body?.hasAttribute('inert')).toBe(true);
    expect(screen.getByText('Member rows')).toBeTruthy();
  });

  it('toggles from the arrow and opens the thread from the name, never both', () => {
    const { onOpen, onToggle } = renderGroup();
    fireEvent.click(screen.getByRole('button', { name: '2 chats in Orders launch' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Orders launch' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps the Needs you count on the row while collapsed', () => {
    renderGroup({ open: false, needsYou: 1 });
    const row = screen.getByRole('button', { name: 'Orders launch, 1 needs you' });
    expect(row.querySelector('.op-needs')?.textContent).toBe('1');
  });

  it('has no arrow and no body when no chat is listed under it', () => {
    renderGroup({ count: 0 });
    expect(screen.queryByRole('button', { name: /in Orders launch$/ })).toBeNull();
    expect(screen.queryByText('Member rows')).toBeNull();
    expect(screen.getByRole('button', { name: 'Orders launch' })).toBeTruthy();
  });
});
