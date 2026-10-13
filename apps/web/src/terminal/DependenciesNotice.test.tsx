// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { NativeTerminalSession } from '@spark-outpost/contracts';
import { DependenciesNotice } from './DependenciesNotice.tsx';

const WAIT = 'Commands that need them may fail until this finishes.';
const session = (dependencies: NativeTerminalSession['dependencies']) =>
  ({ id: 'session-1', dependencies }) as NativeTerminalSession;

afterEach(cleanup);

it('shows nothing when dependencies are ready or were never prepared', () => {
  const { container, rerender } = render(<DependenciesNotice session={session(null)} />);
  expect(container.textContent).toBe('');
  rerender(<DependenciesNotice session={session(undefined)} />);
  expect(container.textContent).toBe('');
});

it('says in one status line that dependencies are still copying, and clears when they are done', () => {
  const preparing = { state: 'preparing', step: 'copy', note: null } as const;
  const { rerender } = render(<DependenciesNotice session={session(preparing)} />);
  expect(screen.getByRole('status').textContent).toBe(`Dependencies are still copying. ${WAIT}`);
  rerender(<DependenciesNotice session={session({ ...preparing, step: 'install' })} />);
  expect(screen.getByRole('status').textContent).toBe(`Dependencies are still installing. ${WAIT}`);
  rerender(<DependenciesNotice session={session(null)} />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('can be dismissed, and a failure after that is still shown', () => {
  const preparing = { state: 'preparing', step: 'copy', note: null } as const;
  const { rerender } = render(<DependenciesNotice session={session(preparing)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByRole('status')).toBeNull();
  const failed = { state: 'failed', step: null, note: 'Installing them failed.' } as const;
  rerender(<DependenciesNotice session={session(failed)} />);
  expect(screen.getByRole('status').textContent).toBe('Installing them failed.');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByRole('status')).toBeNull();
});
