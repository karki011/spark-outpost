// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { NativeTerminalSession } from '@spark-outpost/contracts';
import { ModNotice } from './ModNotice.tsx';

const session = (mod: NativeTerminalSession['mod']) =>
  ({ id: 'session-1', mod }) as NativeTerminalSession;

afterEach(cleanup);

it('shows nothing while the mod is loaded or Spark has no word on it', () => {
  const { container, rerender } = render(<ModNotice session={session(undefined)} />);
  expect(container.textContent).toBe('');
  rerender(<ModNotice session={session({ state: 'loaded', reason: null })} />);
  expect(container.textContent).toBe('');
});

it('says in one line why the mod did not load and that the fallback is used, until dismissed', () => {
  const missing = {
    state: 'missing',
    reason: 'your organization allows only its own mods in Claude Code',
  } as const;
  const { rerender } = render(<ModNotice session={session(missing)} />);
  expect(screen.getByRole('status').textContent).toBe(
    'Spark’s mod didn’t load: your organization allows only its own mods in Claude Code. Using the fallback.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<ModNotice session={session({ state: 'missing', reason: null })} />);
  expect(screen.getByRole('status').textContent).toBe(
    'Spark’s mod didn’t load: it didn’t check in. Using the fallback.',
  );
});
