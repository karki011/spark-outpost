import { expect, it } from 'vitest';
import { sessionView } from './session-view.ts';

const terminal = { state: 'running' };

function detail(
  sessionType: 'chat' | 'terminal',
  row: object | null | undefined,
  messages = 0,
  runs = 0,
) {
  return {
    conversation: { sessionType, terminal: row },
    messages: Array.from({ length: messages }),
    runs: Array.from({ length: runs }),
  };
}

it('has no view until the conversation loads', () => {
  expect(sessionView(undefined, false)).toBeNull();
});

it('shows an empty chat as a draft and a used one as a chat', () => {
  expect(sessionView(detail('chat', null), false)).toBe('draft');
  expect(sessionView(detail('chat', null, 1, 1), false)).toBe('chat');
  expect(sessionView(detail('chat', null, 0, 1), false)).toBe('chat');
});

it('shows a Terminal session whose first launch never reserved a terminal as a draft', () => {
  expect(sessionView(detail('terminal', null), false)).toBe('draft');
  expect(sessionView(detail('terminal', undefined), false)).toBe('draft');
});

it('shows a launched Terminal session as a terminal', () => {
  expect(sessionView(detail('terminal', terminal), false)).toBe('terminal');
  expect(sessionView(detail('terminal', null, 1), false)).toBe('terminal');
});

it('keeps the draft on screen while a terminal is launching', () => {
  expect(sessionView(detail('terminal', terminal), true)).toBe('draft');
  expect(sessionView(detail('chat', null, 1, 1), true)).toBe('draft');
});
