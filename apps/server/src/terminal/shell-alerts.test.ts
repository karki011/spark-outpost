import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellAlert } from '../persistence/shell-alerts.ts';
import { SHELL_ALERT_GAP_MS, shellAlerts } from './shell-alerts.ts';

const CHAT = '11111111-1111-4111-8111-111111111111';
const alert = (text: string) => `\x1b]9;${text}\x07`;

function watch() {
  const recorded: ShellAlert[] = [];
  const watcher = shellAlerts((found) => recorded.push(found));
  const open = (id: string, extra: { agent?: boolean; conversationId?: string | null } = {}) =>
    watcher.opened({
      id,
      conversationId: extra.conversationId === undefined ? CHAT : extra.conversationId,
      label: '~/repo',
      cwd: '/repo',
      pid: 1,
      ...(extra.agent ? { agent: true } : {}),
    });
  return { watcher, recorded, open };
}

describe('alerts from shell tabs', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records an alert for the chat that owns the shell tab', () => {
    const { watcher, recorded, open } = watch();
    open('shell-1');
    watcher.output('shell-1', `make\r\n${alert('Build done')}`);
    expect(recorded).toEqual([
      { conversationId: CHAT, shellId: 'shell-1', label: '~/repo', message: 'Build done' },
    ]);
  });

  it('records an alert whose end arrives in a later chunk with no escape in it', () => {
    const { watcher, recorded, open } = watch();
    open('bell');
    watcher.output('bell', '\x1b]9;Bui');
    watcher.output('bell', 'ld done\x07');
    open('st');
    watcher.output('st', '\x1b]9;Tests passed\x1b');
    watcher.output('st', '\\');
    expect(recorded.map((found) => [found.shellId, found.message])).toEqual([
      ['bell', 'Build done'],
      ['st', 'Tests passed'],
    ]);
  });

  it('ignores Terminal sessions, shells with no chat and unknown shells', () => {
    const { watcher, recorded, open } = watch();
    open('agent', { agent: true });
    open('loose', { conversationId: null });
    for (const id of ['agent', 'loose', 'never-opened']) watcher.output(id, alert('Done'));
    expect(recorded).toEqual([]);
  });

  it('keeps only the latest alert in a burst and sends it after the gap', () => {
    const { watcher, recorded, open } = watch();
    open('shell-1');
    watcher.output('shell-1', alert('first'));
    for (let step = 0; step < 50; step += 1) watcher.output('shell-1', alert(`step ${step}`));
    expect(recorded.map((found) => found.message)).toEqual(['first']);
    vi.advanceTimersByTime(SHELL_ALERT_GAP_MS);
    expect(recorded.map((found) => found.message)).toEqual(['first', 'step 49']);
    vi.advanceTimersByTime(SHELL_ALERT_GAP_MS * 3);
    expect(recorded).toHaveLength(2);
  });

  it('sends a waiting alert when the shell ends and forgets the shell', () => {
    const { watcher, recorded, open } = watch();
    open('shell-1');
    watcher.output('shell-1', alert('first'));
    watcher.output('shell-1', alert('last words'));
    watcher.ended('shell-1');
    expect(recorded.map((found) => found.message)).toEqual(['first', 'last words']);
    vi.advanceTimersByTime(SHELL_ALERT_GAP_MS);
    watcher.output('shell-1', alert('after the end'));
    expect(recorded).toHaveLength(2);
  });
});
