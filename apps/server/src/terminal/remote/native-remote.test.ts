import { describe, expect, it } from 'vitest';
import type { Db } from '../../persistence/db.ts';
import type { LiveSession } from '../native-runtime-types.ts';
import { terminalApprovals } from './approvals.ts';
import { approvalDetail, codexMenuShows, nativeRemote, pastedMessage } from './native-remote.ts';

const CODEX_MENU = [
  '  Would you like to run the following command?',
  '  $ touch notes.txt',
  '› 1. Yes, proceed (y)',
  '  3. No, and tell Codex what to do differently (esc)',
  '  Press enter to confirm or esc to cancel',
].join('\n');

function setup(provider: 'claude' | 'codex', options: { state?: string; approve?: boolean } = {}) {
  const row = {
    id: 's1',
    conversation_id: 'c1',
    provider,
    state: options.state ?? 'ready',
    usage_file: null,
  };
  const db = {
    query: async (sql: string) => ({
      rows: sql.includes('remote_access_settings')
        ? [{ hostname: null, can_terminal: true, can_terminal_approve: options.approve ?? true }]
        : [row],
    }),
  } as unknown as Db;
  const session = { row, transcript: null, remoteApprovals: true } as unknown as LiveSession;
  const sent: string[] = [];
  let screen: string | null = CODEX_MENU;
  const approvals = terminalApprovals();
  const remote = nativeRemote({
    db,
    workspaceId: 'w',
    live: new Map([['c1', session]]),
    terminals: {
      send: (_id, data) => {
        sent.push(data);
        return true;
      },
      screen: async () => screen,
    },
    approvals,
    delay: async () => undefined,
  });
  return { remote, session, sent, approvals, setScreen: (text: string | null) => (screen = text) };
}

describe('typing from a paired device', () => {
  it('pastes the message as one block, then presses Enter', async () => {
    const { remote, sent } = setup('claude');
    await remote.message('c1', 'Line one\r\nLine two');
    expect(sent).toEqual(['\u001b[200~Line one\nLine two\u001b[201~', '\r']);
  });

  it('drops control characters so a message cannot end the paste early', () => {
    expect(pastedMessage('a\u001b[201~b\u0003c\td')).toBe('\u001b[200~a[201~bc\td\u001b[201~');
  });

  it('refuses a message while the agent waits for an answer', async () => {
    const { remote, sent } = setup('claude', { state: 'waiting_for_permission' });
    await expect(remote.message('c1', 'hello')).rejects.toMatchObject({ status: 409 });
    expect(sent).toEqual([]);
  });

  it('sends Esc for Stop', () => {
    const { remote, sent } = setup('codex');
    remote.interrupt('c1');
    expect(sent).toEqual(['\u001b']);
  });
});

describe('approving from a paired device', () => {
  it('answers a Claude request through its waiting hook', async () => {
    const { remote, session } = setup('claude');
    const waiting = remote.permission(
      session,
      { tool: 'Bash', input: { command: 'pnpm test' } },
      new AbortController().signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const view = await remote.view('c1');
    expect(view.approval).toMatchObject({
      tool: 'Bash',
      detail: 'pnpm test',
      denyStopsTurn: false,
    });
    await remote.decide('c1', { id: view.approval!.id, decision: 'deny' });
    await expect(waiting).resolves.toBe('deny');
    await expect(
      remote.decide('c1', { id: view.approval!.id, decision: 'allow' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('does not wait when approvals are switched off', async () => {
    const { remote, session, approvals } = setup('claude', { approve: false });
    await expect(
      remote.permission(session, { tool: 'Bash', input: {} }, new AbortController().signal),
    ).resolves.toBeNull();
    expect(approvals.current('c1')).toBeNull();
  });

  it('presses y in Codex only while its menu shows that command', async () => {
    const { remote, session, sent, setScreen } = setup('codex');
    await remote.permission(
      session,
      { tool: 'Bash', input: { command: 'touch notes.txt' } },
      new AbortController().signal,
    );
    const { approval } = await remote.view('c1');
    setScreen('› Ask Codex to do anything');
    await expect(
      remote.decide('c1', { id: approval!.id, decision: 'allow' }),
    ).rejects.toMatchObject({
      status: 409,
    });
    setScreen(CODEX_MENU);
    await remote.decide('c1', { id: approval!.id, decision: 'allow' });
    expect(sent).toEqual(['y']);
  });

  it('sends Esc to deny in Codex, and refuses when the pane cannot be read', async () => {
    const { remote, session, sent, setScreen } = setup('codex');
    const ask = () =>
      remote.permission(
        session,
        { tool: 'Bash', input: { command: 'touch notes.txt' } },
        new AbortController().signal,
      );
    await ask();
    setScreen(null);
    const first = (await remote.view('c1')).approval!;
    await expect(remote.decide('c1', { id: first.id, decision: 'deny' })).rejects.toMatchObject({
      status: 409,
    });
    setScreen(CODEX_MENU);
    await remote.decide('c1', { id: first.id, decision: 'deny' });
    expect(sent).toEqual(['\u001b']);
  });

  it('forgets an open approval once the CLI moves on', async () => {
    const { remote, session } = setup('codex');
    await remote.permission(session, { tool: 'Bash', input: {} }, new AbortController().signal);
    remote.observed(session, 'PostToolUse');
    expect((await remote.view('c1')).approval).toBeNull();
  });
});

describe('approval details', () => {
  it('names the file of a Codex patch and the command of a shell call', () => {
    expect(
      approvalDetail('apply_patch', {
        command: '*** Begin Patch\n*** Add File: /work/notes.txt\n+hi\n*** End Patch',
      }),
    ).toBe('/work/notes.txt');
    expect(approvalDetail('Bash', { command: 'git status', description: 'Show status' })).toBe(
      'git status',
    );
  });

  it('finds a wrapped command in the Codex menu', () => {
    expect(
      codexMenuShows(CODEX_MENU.replace('touch notes.txt', 'touch no\ntes.txt'), 'touch notes.txt'),
    ).toBe(true);
    expect(codexMenuShows(CODEX_MENU, 'rm -rf build')).toBe(false);
  });
});
