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
const IDLE = '› Ask Codex to do anything\n  gpt · /work';

function setup(
  provider: 'claude' | 'codex',
  options: { state?: string; approve?: boolean; type?: boolean; whilePasting?: () => void } = {},
) {
  const row = {
    id: 's1',
    conversation_id: 'c1',
    provider,
    state: options.state ?? 'ready',
    active_run_id: 'r1' as string | null,
    usage_file: null,
  };
  const db = {
    query: async (sql: string) => ({
      rows: sql.includes('remote_access_settings')
        ? [
            {
              hostname: null,
              can_terminal: options.type ?? true,
              can_terminal_approve: options.approve ?? true,
            },
          ]
        : sql.includes('FROM runs')
          ? [{ at: new Date('2026-10-14T10:00:00Z') }]
          : [row],
    }),
  } as unknown as Db;
  const session = { row, transcript: null } as unknown as LiveSession;
  const sent: string[] = [];
  let screen: string | null = IDLE;
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
    owned: async () => undefined,
    delay: async () => options.whilePasting?.(),
  });
  return {
    remote,
    session,
    row,
    sent,
    approvals,
    setScreen: (text: string | null) => (screen = text),
  };
}

async function askCodex(codex: ReturnType<typeof setup>) {
  await codex.remote.permission(
    codex.session,
    { tool: 'Bash', input: { command: 'touch notes.txt' } },
    new AbortController().signal,
  );
  codex.setScreen(CODEX_MENU);
  return (await codex.remote.view('c1')).approval!;
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

  it('leaves the message unsent when a menu opens before Enter', async () => {
    const menu = setup('codex', { whilePasting: () => menu.setScreen(CODEX_MENU) });
    await expect(menu.remote.message('c1', 'hello')).rejects.toMatchObject({ status: 409 });
    expect(menu.sent).toEqual(['\u001b[200~hello\u001b[201~']);
  });

  it('refuses a message while the agent waits for an answer', async () => {
    const { remote, sent } = setup('claude', { state: 'waiting_for_permission' });
    await expect(remote.message('c1', 'hello')).rejects.toMatchObject({ status: 409 });
    expect(sent).toEqual([]);
  });

  it('sends Esc for Stop only while the agent works, never to an idle prompt', async () => {
    const working = setup('codex', { state: 'working' });
    await working.remote.interrupt('c1');
    expect(working.sent).toEqual(['\u001b']);
    const idle = setup('claude', { state: 'ready' });
    await expect(idle.remote.interrupt('c1')).rejects.toMatchObject({ status: 409 });
    expect(idle.sent).toEqual([]);
  });

  it('refuses messages that would run a CLI command', async () => {
    const { remote, sent } = setup('claude');
    for (const text of ['/model', '  !rm -rf build', '/permissions'])
      await expect(remote.message('c1', text)).rejects.toMatchObject({ status: 409 });
    expect(sent).toEqual([]);
  });

  it('refuses a message while any menu shows, even one Spark was not told about', async () => {
    const { remote, sent, setScreen } = setup('codex');
    setScreen(CODEX_MENU);
    await expect(remote.message('c1', '2')).rejects.toMatchObject({ status: 409 });
    setScreen('   Rewind\n   ❯ (current)\n   Enter to continue · Esc to cancel');
    await expect(remote.message('c1', 'go on')).rejects.toMatchObject({ status: 409 });
    setScreen('✻ Working… (esc to interrupt)\n❯ ');
    await remote.message('c1', 'go on');
    expect(sent).toHaveLength(2);
  });
});

describe('the view a paired device reads', () => {
  it('says since when the agent has been working, and nothing while it is idle', async () => {
    const working = setup('claude', { state: 'working' });
    expect((await working.remote.view('c1')).workingSince).toBe('2026-10-14T10:00:00.000Z');
    working.row.active_run_id = null;
    expect((await working.remote.view('c1')).workingSince).toBeNull();
    const idle = setup('claude', { state: 'ready' });
    expect((await idle.remote.view('c1')).workingSince).toBeNull();
  });
});

describe('sending now from a paired device', () => {
  it('stops the turn with Esc, then sends the message', async () => {
    const { remote, sent } = setup('claude', { state: 'working' });
    await remote.message('c1', 'Use the other file', true);
    expect(sent).toEqual(['\u001b', '\u001b[200~Use the other file\u001b[201~', '\r']);
  });

  it('sends no Esc when the agent is not working', async () => {
    const { remote, sent } = setup('codex', { state: 'ready' });
    await remote.message('c1', 'Next step', true);
    expect(sent).toEqual(['\u001b[200~Next step\u001b[201~', '\r']);
  });

  it('sends nothing, not even Esc, while a menu shows or for a CLI command', async () => {
    const { remote, sent, setScreen } = setup('codex', { state: 'working' });
    await expect(remote.message('c1', '/model', true)).rejects.toMatchObject({ status: 409 });
    setScreen(CODEX_MENU);
    await expect(remote.message('c1', 'go on', true)).rejects.toMatchObject({ status: 409 });
    expect(sent).toEqual([]);
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
    await remote.decide('c1', { id: view.approval!.id, decision: 'deny', reason: ' Use pnpm ' });
    await expect(waiting).resolves.toEqual({ behavior: 'deny', message: 'Use pnpm' });
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

  it('denies in Codex, then sends the reason once its menu is gone', async () => {
    const codex = setup('codex', {
      state: 'waiting_for_permission',
      whilePasting: () => {
        codex.row.state = 'ready';
        codex.setScreen(IDLE);
      },
    });
    const approval = await askCodex(codex);
    await codex.remote.decide('c1', { id: approval.id, decision: 'deny', reason: 'Use pnpm' });
    expect(codex.sent).toEqual(['\u001b', '\u001b[200~Use pnpm\u001b[201~', '\r']);
  });

  it('says the denial went through when the reason cannot be sent', async () => {
    const codex = setup('codex', { state: 'waiting_for_permission' });
    const approval = await askCodex(codex);
    await expect(
      codex.remote.decide('c1', { id: approval.id, decision: 'deny', reason: 'Use pnpm' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Denied\. /) });
    expect(codex.sent).toEqual(['\u001b']);
    expect(codex.approvals.current('c1')).toBeNull();
  });

  it('refuses a Codex reason that would run a CLI command before answering', async () => {
    const codex = setup('codex', { state: 'waiting_for_permission' });
    const approval = await askCodex(codex);
    await expect(
      codex.remote.decide('c1', { id: approval.id, decision: 'deny', reason: '/model' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(codex.sent).toEqual([]);
    expect(codex.approvals.current('c1')?.id).toBe(approval.id);
  });

  it('refuses a Codex reason when typing is switched off, before answering', async () => {
    const codex = setup('codex', { state: 'waiting_for_permission', type: false });
    const approval = await askCodex(codex);
    await expect(
      codex.remote.decide('c1', { id: approval.id, decision: 'deny', reason: 'Use pnpm' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(codex.sent).toEqual([]);
    await codex.remote.decide('c1', { id: approval.id, decision: 'deny' });
    expect(codex.sent).toEqual(['\u001b']);
  });

  it('keeps a waiting Claude approval when another tool finishes, until the turn ends', async () => {
    const { remote, session } = setup('claude');
    const answer = remote.permission(
      session,
      { tool: 'Bash', input: { command: 'touch notes.txt' } },
      new AbortController().signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    remote.observed(session, 'PostToolUse');
    expect((await remote.view('c1')).approval).not.toBeNull();
    remote.observed(session, 'Stop');
    expect(await answer).toBeNull();
    expect((await remote.view('c1')).approval).toBeNull();
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
