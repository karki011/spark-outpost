// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoAgentConfig } from '@spark-outpost/contracts';
import { TrustChip } from './TrustChip.tsx';

const config = {
  hooks: [{}, {}],
  allowRules: [{}],
  mcpServers: [],
  trust: { needed: true, state: 'unset', fingerprint: 'fp-1', changes: [] },
} as unknown as RepoAgentConfig;

function setup(props: { prompt?: 'ask' | 'changed'; canDecide?: boolean; error?: string } = {}) {
  const onChange = vi.fn();
  const onReview = vi.fn();
  render(
    <TrustChip
      config={config}
      prompt={props.prompt ?? 'ask'}
      name="app"
      busy={false}
      canDecide={props.canDecide ?? true}
      error={props.error ?? null}
      onChange={onChange}
      onReview={onReview}
    />,
  );
  return { onChange, onReview };
}

afterEach(cleanup);

describe('TrustChip', () => {
  it('asks with a summary and offers Trust, Not now and Review', () => {
    setup();
    const group = screen.getByRole('group', { name: 'Trust app?' });
    expect(group.textContent).toContain('Trust this folder?');
    expect(group.textContent).toContain('2 hooks, 1 allow rule');
    expect(screen.getByRole('button', { name: 'Trust' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
  });

  it('trusts with the fingerprint it was shown', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Trust' }));
    expect(onChange).toHaveBeenCalledWith({
      type: 'trust',
      change: { trusted: true, fingerprint: 'fp-1' },
    });
  });

  it('declines with trusted false', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onChange).toHaveBeenCalledWith({ type: 'trust', change: { trusted: false } });
  });

  it('opens the review from Review', () => {
    const { onReview, onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers only Review when the setup changed', () => {
    setup({ prompt: 'changed' });
    expect(screen.getByText('Folder setup changed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Trust' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('offers only Review where the device cannot change settings', () => {
    setup({ canDecide: false });
    expect(screen.queryByRole('button', { name: 'Trust' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
  });

  it('shows a failed save as an alert', () => {
    setup({ error: 'Folder setup changed' });
    expect(screen.getByRole('alert').textContent).toBe('Folder setup changed');
  });
});
