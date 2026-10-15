import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../src/projects/projects.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';
import { ownedWorktree } from './stack-support.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture();
});
afterEach(async () => {
  await f?.cleanup();
});

const OLD = 'plainoldvalue5512';
const NEW = 'plainnewvalue8823';
const AT = 1_792_000_000_000;
const owned = { prompt: 'first', agent: null };
const git = (...args: string[]) => execFileSync('git', args, { cwd: f.folder, stdio: 'pipe' });

async function project(files: Record<string, string>) {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  for (const [name, text] of Object.entries({ 'README.md': 'hello\n', ...files }))
    await writeFile(join(f.folder, name), text);
  git('add', '.');
  git('commit', '-q', '-m', 'start');
  await f.t.db.query(
    `INSERT INTO profiles (workspace_id, terminal_record_like_chat) VALUES ($1, true)
     ON CONFLICT (workspace_id) DO UPDATE SET terminal_record_like_chat = true`,
    [f.t.workspaceId],
  );
}

const call = (id: string, name: string, input: Record<string, unknown>, output: string) => [
  { kind: 'tool', ...owned, id, name, phase: 'start', failed: false, at: AT, input },
  { kind: 'tool', ...owned, id, name, phase: 'end', failed: false, at: AT, output, asked: false },
];

async function turn(work: () => Promise<void>, calls: unknown[]) {
  await f.launch();
  await f.hook('UserPromptSubmit', {
    prompt: 'Go',
    prompt_id: 'first',
    transcript_path: '/f/s.jsonl',
  });
  await f.modFacts([{ kind: 'turn_start', ...owned, turn: 't1', at: AT, record: true }]);
  await work();
  await f.modFacts(calls);
  await f.hook('Stop', { prompt_id: 'first' });
}

const rows = async (sql: string) =>
  (await f.t.db.query(sql.replaceAll(':c', `'${f.conversationId}'`))).rows;

describe('flags for a recorded Terminal session', () => {
  it('raise no flag for a push of the chat’s own spark branch, and flag another branch', async () => {
    await project({});
    const projectId = (await createProject(f.t.db, f.t.workspaceId, f.folder)).project.id;
    await ownedWorktree(
      f.t,
      { conversationId: f.conversationId, projectId, root: f.folder, path: f.folder },
      'spark/notes',
      'main',
    );
    await turn(
      async () => undefined,
      [
        ...call('toolu_own', 'Bash', { command: 'git push origin spark/notes' }, 'ok'),
        ...call('toolu_main', 'Bash', { command: 'git push origin main' }, 'ok'),
      ],
    );
    const flags = await rows(
      `SELECT f.rail, f.paths FROM rail_flags f JOIN runs r ON r.id = f.run_id
       WHERE r.conversation_id = :c`,
    );
    expect(flags).toEqual([{ rail: 'other_push', paths: ['main'] }]);
  });

  it('records an edit of a secret file by its path, never its old or new value', async () => {
    await project({ '.env.local': `TOKEN=${OLD}\n` });
    await turn(
      () => writeFile(join(f.folder, '.env.local'), `TOKEN=${NEW}\n`),
      call(
        'toolu_secret',
        'Edit',
        {
          file_path: join(f.folder, '.env.local'),
          old_string: OLD,
          new_string: NEW,
        },
        'The file was updated.',
      ),
    );
    const stored = await rows(
      `SELECT e.payload::text AS text FROM run_events e JOIN runs r ON r.id = e.run_id
         WHERE r.conversation_id = :c
       UNION ALL SELECT l.payload::text FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
         WHERE r.conversation_id = :c
       UNION ALL SELECT f.paths::text || f.originals::text FROM rail_flags f
         JOIN runs r ON r.id = f.run_id WHERE r.conversation_id = :c
       UNION ALL SELECT a.payload::text FROM approvals a JOIN runs r ON r.id = a.run_id
         WHERE r.conversation_id = :c
       UNION ALL SELECT o.kept::text FROM task_outcomes o JOIN runs r ON r.id = o.run_id
         WHERE r.conversation_id = :c
       UNION ALL SELECT s.name FROM native_terminal_steps s JOIN runs r ON r.id = s.run_id
         WHERE r.conversation_id = :c
       UNION ALL SELECT content FROM messages WHERE conversation_id = :c`,
    );
    const text = stored.map((row) => String(row.text)).join('\n');
    expect(text).toContain('.env.local');
    expect(text).toContain('toolu_secret');
    expect(text).not.toContain(OLD);
    expect(text).not.toContain(NEW);
  });

  it('stores a replayed or partly replayed batch of details once', async () => {
    await project({});
    const facts = [
      ...call('toolu_a', 'Bash', { command: 'npm test' }, 'passed'),
      { kind: 'reply', ...owned, turn: 't1', index: 0, text: 'Tests pass.' },
      ...call('toolu_b', 'Bash', { command: 'npm run lint' }, 'clean'),
      { kind: 'reply', ...owned, turn: 't1', index: 1, text: 'Lint is clean.' },
    ];
    await turn(async () => {
      expect(await f.modFacts(facts.slice(0, 3))).toBe(204);
      expect(await f.modFacts(facts)).toBe(204);
    }, facts);
    const commands = await rows(
      `SELECT c.command FROM run_commands c JOIN runs r ON r.id = c.run_id
       WHERE r.conversation_id = :c ORDER BY c.started_at`,
    );
    expect(commands.map((row) => row.command)).toEqual(['npm test', 'npm run lint']);
    const replies = await rows(
      `SELECT content FROM messages WHERE conversation_id = :c AND role = 'assistant'`,
    );
    expect(replies).toEqual([{ content: 'Tests pass.\n\nLint is clean.' }]);
    const audited = await rows(
      `SELECT l.payload->'params'->'update'->>'toolCallId' AS id FROM run_protocol_log l
       JOIN runs r ON r.id = l.run_id
       WHERE r.conversation_id = :c AND l.payload->'params'->'update'->>'sessionUpdate' = 'tool_call'`,
    );
    expect(audited.map((row) => row.id).sort()).toEqual(['toolu_a', 'toolu_b']);
  });
});
