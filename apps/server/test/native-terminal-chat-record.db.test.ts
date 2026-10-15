import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture();
});
afterEach(async () => {
  await f?.cleanup();
});

const SECRET = 'sk-terminal-secret-4471';
const AT = 1_792_000_000_000;
const git = (...args: string[]) => execFileSync('git', args, { cwd: f.folder, stdio: 'pipe' });

async function project() {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  await writeFile(join(f.folder, 'README.md'), 'hello\n');
  await writeFile(join(f.folder, '.gitignore'), '.env\n');
  git('add', '.');
  git('commit', '-q', '-m', 'start');
  await writeFile(join(f.folder, '.env'), `TOKEN=${SECRET}\n`);
}

const recording = (on: boolean) =>
  f.t.db.query(
    `INSERT INTO profiles (workspace_id, terminal_record_like_chat) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET terminal_record_like_chat = $2`,
    [f.t.workspaceId, on],
  );
const prompt = (prompt_id: string) =>
  f.hook('UserPromptSubmit', { prompt: 'Do the thing', prompt_id, transcript_path: '/f/s.jsonl' });
const owned = { prompt: 'first', agent: null };
const tool = (id: string, name: string, input: Record<string, unknown>, output: string) => [
  { kind: 'tool', ...owned, id, name, phase: 'start', failed: false, at: AT, input },
  {
    kind: 'tool',
    ...owned,
    id,
    name,
    phase: 'end',
    failed: false,
    at: AT + 10,
    output,
    asked: false,
  },
];

async function workedTurn() {
  await f.launch();
  await prompt('first');
  await f.modFacts([{ kind: 'turn_start', ...owned, turn: 't1', at: AT, record: true }]);
  await writeFile(join(f.folder, 'notes.md'), 'kept\n');
  await f.modFacts([
    ...tool('toolu_read', 'Read', { file_path: join(f.folder, '.env') }, `TOKEN=${SECRET}`),
    ...tool('toolu_echo', 'Bash', { command: `echo ${SECRET}` }, `${SECRET}\n`),
    ...tool(
      'toolu_write',
      'Write',
      { file_path: join(f.folder, 'notes.md'), content: 'kept\n' },
      'ok',
    ),
    ...tool('toolu_push', 'Bash', { command: 'git push --force origin main' }, 'pushed'),
    { kind: 'reply', ...owned, turn: 't1', text: `I wrote notes.md and pushed ${SECRET}.` },
  ]);
  await f.hook('Stop', { prompt_id: 'first' });
}

const query = async (sql: string) =>
  (await f.t.db.query(sql.replaceAll(':conversation', `'${f.conversationId}'`))).rows;

const stored = async () => ({
  commands: await query(
    `SELECT c.command FROM run_commands c JOIN runs r ON r.id = c.run_id
     WHERE r.conversation_id = :conversation ORDER BY c.started_at`,
  ),
  replies: await query(
    `SELECT content FROM messages WHERE conversation_id = :conversation AND role = 'assistant'`,
  ),
  kept: await query(
    `SELECT a.payload FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = :conversation AND a.tool_call_id LIKE 'checkpoint:%'`,
  ),
  flags: await query(
    `SELECT f.rail, f.paths FROM rail_flags f JOIN runs r ON r.id = f.run_id
     WHERE r.conversation_id = :conversation ORDER BY f.rail`,
  ),
  audited: await query(
    `SELECT l.payload, l.unreviewed FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
     WHERE r.conversation_id = :conversation AND l.payload::text LIKE '%toolu_%'`,
  ),
  runs: await query(`SELECT status FROM runs WHERE conversation_id = :conversation`),
  everything: await query(
    `SELECT e.payload::text AS text FROM run_events e JOIN runs r ON r.id = e.run_id
       WHERE r.conversation_id = :conversation
     UNION ALL SELECT l.payload::text FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
       WHERE r.conversation_id = :conversation
     UNION ALL SELECT c.command || ' ' || COALESCE(c.output, '') FROM run_commands c
       JOIN runs r ON r.id = c.run_id WHERE r.conversation_id = :conversation
     UNION ALL SELECT content FROM messages WHERE conversation_id = :conversation`,
  ),
});

describe('a Claude Terminal session recorded like a chat', () => {
  it('keeps commands, the reply, the kept record and an audit entry per tool call', async () => {
    await project();
    await recording(true);
    await workedTurn();
    const seen = await stored();
    expect(seen.runs).toEqual([{ status: 'succeeded' }]);
    expect(seen.commands.map((row) => row.command)).toEqual([
      expect.stringMatching(/^echo (?!sk-terminal)/),
      'git push --force origin main',
    ]);
    expect(seen.replies).toHaveLength(1);
    expect(seen.replies[0]!.content).toMatch(/^I wrote notes\.md and pushed /);
    expect(JSON.stringify(seen.kept)).toContain('notes.md');
    const unreviewed = seen.audited.filter((row) => row.unreviewed).map((row) => row.payload);
    expect(JSON.stringify(unreviewed)).toContain('toolu_write');
    expect(JSON.stringify(unreviewed)).toContain('toolu_push');
    expect(JSON.stringify(unreviewed)).not.toContain('toolu_read');
  });

  it('flags a force push, another branch’s push and a send after a secret read, never stopping', async () => {
    await project();
    await recording(true);
    await workedTurn();
    const seen = await stored();
    expect(seen.flags.map((row) => row.rail)).toEqual(['force_push', 'other_push', 'sent_out']);
    expect(seen.runs).toEqual([{ status: 'succeeded' }]);
  });

  it('records a later turn of the session in its own folder, push flag included', async () => {
    await project();
    await recording(true);
    await f.launch();
    await prompt('first');
    await f.modFacts([{ kind: 'turn_start', ...owned, turn: 't1', at: AT, record: true }]);
    await f.hook('Stop', { prompt_id: 'first' });
    await prompt('second');
    const later = { prompt: 'second', agent: null };
    const command = 'git push origin HEAD:feature-x';
    await f.modFacts([
      { kind: 'turn_start', ...later, turn: 't2', at: AT, record: true },
      {
        kind: 'tool',
        ...later,
        id: 'toolu_p',
        name: 'Bash',
        phase: 'start',
        failed: false,
        at: AT,
        input: { command },
      },
      {
        kind: 'tool',
        ...later,
        id: 'toolu_p',
        name: 'Bash',
        phase: 'end',
        failed: false,
        at: AT,
        output: 'ok',
        asked: false,
      },
    ]);
    await writeFile(join(f.folder, 'later.md'), 'second turn\n');
    await f.hook('Stop', { prompt_id: 'second' });
    const seen = await stored();
    expect(seen.flags).toEqual([{ rail: 'other_push', paths: ['feature-x'] }]);
    expect(JSON.stringify(seen.kept)).toContain('later.md');
  });

  it('never stores a secret file’s value: a command, its output, the reply and the audit hide it', async () => {
    await project();
    await recording(true);
    await workedTurn();
    const seen = await stored();
    expect(seen.everything.length).toBeGreaterThan(10);
    for (const row of seen.everything) expect(String(row.text)).not.toContain(SECRET);
    expect(JSON.stringify(seen.everything)).toContain('.env');
  });

  it('records nothing more than before when the setting is off', async () => {
    await project();
    await recording(false);
    await workedTurn();
    const seen = await stored();
    expect([seen.commands, seen.replies, seen.kept, seen.flags, seen.audited]).toEqual([
      [],
      [],
      [],
      [],
      [],
    ]);
    const steps = await query(`SELECT name FROM native_terminal_steps ORDER BY tool_use_id`);
    expect(steps.map((row) => row.name)).toEqual(['Bash', 'Bash', 'Read', 'Write']);
  });

  it('records nothing more when the mod sends no details', async () => {
    await project();
    await recording(true);
    await f.launch();
    await prompt('first');
    await f.modFacts([
      { kind: 'turn_start', ...owned, turn: 't1', at: AT },
      {
        kind: 'tool',
        ...owned,
        id: 'toolu_1',
        name: 'Bash',
        phase: 'start',
        failed: false,
        at: AT,
      },
    ]);
    await f.hook('Stop', { prompt_id: 'first' });
    const seen = await stored();
    expect([seen.commands, seen.replies, seen.kept, seen.audited]).toEqual([[], [], [], []]);
    expect(await query('SELECT 1 FROM runs WHERE snapshot_kind IS NOT NULL')).toEqual([]);
  });

  it('leaves a Codex session as it was', async () => {
    await f.cleanup();
    f = await nativeRuntimeFixture({ provider: 'codex' });
    await recording(true);
    await f.launch();
    expect(await f.modFacts(tool('toolu_1', 'Bash', { command: 'ls' }, 'x'))).toBe(400);
    expect((await stored()).commands).toEqual([]);
  });
});
