// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ProviderSwitch } from './ProviderSwitch.tsx';

afterEach(cleanup);

const providers = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
] as const;

const focusable = () =>
  screen.getAllByRole('tab').filter((tab) => tab.getAttribute('tabindex') === '0');

it('keeps one tab reachable by keyboard when no provider is active', () => {
  render(<ProviderSwitch providers={providers} active={null} onSelect={() => {}} />);
  expect(focusable().map((tab) => tab.getAttribute('aria-label'))).toEqual(['Claude Code']);
});

it('makes the active provider the reachable tab', () => {
  render(<ProviderSwitch providers={providers} active="codex" onSelect={() => {}} />);
  expect(focusable().map((tab) => tab.getAttribute('aria-label'))).toEqual(['Codex']);
});
