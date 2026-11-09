import { describe, expect, it } from 'vitest';
import { DENIES_REASON } from './decide.ts';
import {
  NO_FOLDER_REASON,
  OUTSIDE_FOLDER_REASON,
  READ_ONLY_TURN_REASON,
  SECRET_COMMAND_REASON,
  SPARK_COMMAND_NOTE,
  commandHoldsSecret,
  decideSparkCommand,
  runsAtOnce,
  sparkCommandRequest,
} from './spark-command.ts';
import {
  HOME,
  ROOT,
  decided,
  inPosture,
  noFiles,
  request,
  turn,
} from './spark-command-fixtures.ts';

describe('the request for a Spark-run command', () => {
  it('has every field an agent’s own command request has', () => {
    const built = sparkCommandRequest(turn({ agentMode: 'default' }), {
      toolCallId: 'call-9',
      command: 'pnpm dev',
      cwd: `${ROOT}/apps/web`,
    });
    expect(built).toEqual({
      toolCallId: 'call-9',
      rpcId: null,
      kind: 'execute',
      toolKind: 'execute',
      title: 'pnpm dev',
      command: 'pnpm dev',
      cwd: `${ROOT}/apps/web`,
      paths: [],
      diffs: [],
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      ],
      roots: [{ path: ROOT, ignore: [] }],
      home: HOME,
      mode: 'default',
    });
  });

  it('offers no always option and starts in the chat’s folder by default', () => {
    const built = request('pnpm dev');
    expect(built.options.map((option) => option.kind)).toEqual(['allow_once', 'reject_once']);
    expect(built.cwd).toBe(ROOT);
    expect(built.agentReason).toBeUndefined();
  });
});

describe('a command that looks like it holds a secret', () => {
  it.each([
    'OPENAI_API_KEY=abc123 pnpm dev',
    'pnpm dev --token=abc123',
    'pnpm dev --password hunter2',
    'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345" https://example.com',
  ])('refuses %s', async (command) => {
    expect(commandHoldsSecret(command)).toBe(true);
    expect(await decided(command)).toEqual({ verdict: 'reject', reason: SECRET_COMMAND_REASON });
  });

  it.each(['pnpm dev', 'PORT=5173 pnpm dev', 'vitest --watch', 'pnpm dev --host=0.0.0.0'])(
    'lets %s through',
    (command) => {
      expect(commandHoldsSecret(command)).toBe(false);
    },
  );
});

describe('where it may start', () => {
  it('is refused in a chat without a project folder', async () => {
    expect(await decided('pnpm dev', turn({ roots: [] }))).toEqual({
      verdict: 'reject',
      reason: NO_FOLDER_REASON,
    });
  });

  it('is refused in an Ask turn, a read-only mode and an assistant turn', async () => {
    const refusal = { verdict: 'reject', reason: READ_ONLY_TURN_REASON };
    expect(await decided('ls', turn({ runMode: 'ask' }))).toEqual(refusal);
    expect(await decided('ls', turn({ runMode: null }))).toEqual(refusal);
    expect(await decided('ls', inPosture('read_only'))).toEqual(refusal);
    expect(await decided('ls', turn({ readOnly: true }))).toEqual(refusal);
  });

  it('is refused outside the linked folders, and allowed in a folder under one', () => {
    const on = turn();
    const outside = decideSparkCommand(on, request('pnpm dev', on, '/Users/me/elsewhere'), {
      files: noFiles,
    });
    expect(outside).toEqual({ verdict: 'reject', reason: OUTSIDE_FOLDER_REASON });
    const inside = decideSparkCommand(on, request('pnpm dev', on, `${ROOT}/apps/web`), {
      files: noFiles,
    });
    expect(inside.verdict).toBe('allow');
  });
});

describe('the agent’s mode decides', () => {
  it('runs at once in Auto, Bypass permissions, Auto review and Full access', async () => {
    expect(runsAtOnce('auto')).toBe(true);
    expect(runsAtOnce('full_access')).toBe(true);
    for (const posture of ['auto', 'full_access'] as const) {
      expect(await decided('pnpm dev', inPosture(posture))).toEqual({
        verdict: 'allow',
        by: 'level',
      });
    }
  });

  it.each(['asks', 'edits', 'unknown'] as const)(
    'shows an ordinary card in a mode that %s',
    async (posture) => {
      expect(runsAtOnce(posture)).toBe(false);
      expect(await decided('pnpm dev', inPosture(posture))).toEqual({
        verdict: 'ask',
        reason: null,
        because: SPARK_COMMAND_NOTE,
      });
    },
  );

  it('cards a command that only reads, which the agent’s own tool would just run', async () => {
    expect(await decided('ls -la', inPosture('asks'))).toEqual({
      verdict: 'ask',
      reason: null,
      because: SPARK_COMMAND_NOTE,
    });
  });

  it('is refused in a mode that skips anything not pre-approved', async () => {
    const refusal = { verdict: 'reject', reason: DENIES_REASON };
    expect(await decided('pnpm dev', inPosture('denies'))).toEqual(refusal);
    expect(await decided('ls -la', inPosture('denies'))).toEqual(refusal);
  });
});
