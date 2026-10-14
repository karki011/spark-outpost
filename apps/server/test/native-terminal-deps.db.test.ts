import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeChat } from '../src/orchestration/chat-place.ts';
import type { DepsOptions, DepsPrep } from '../src/projects/worktree-deps.ts';
import { pendingDir } from '../src/terminal/session-deps.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

const prepared: DepsPrep = {
  method: 'clone',
  durationMs: 1,
  note: null,
  folders: 1,
  lockfileMatched: true,
  stale: false,
};
const PREPARING = { state: 'preparing', step: null, note: null };

let f: NativeRuntimeFixture;
let repo: string;
let calls: DepsOptions[];
let release: (prep: DepsPrep) => void;

const dependencies = async () => (await f.runtime.get(f.conversationId))?.dependencies ?? null;
const worktree = () => f.spawn.mock.calls.at(-1)![0].cwd!;

beforeEach(async () => {
  f = await nativeRuntimeFixture();
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'spark-native-deps-')));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'package.json'), '{"name":"app"}');
  git('add', '.');
  git('commit', '-qm', 'base');
  const projectId = randomUUID();
  await f.t.db.query(
    `INSERT INTO projects (id, workspace_id, name, root_path, work_place)
     VALUES ($1, $2, 'app', $3, 'worktree')`,
    [projectId, f.t.workspaceId, repo],
  );
  await f.t.db.query(
    'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
    [f.conversationId, projectId],
  );
  f.place = placeChat;
  calls = [];
  f.prepareDependencies = (_main, _copy, options) =>
    new Promise<DepsPrep | null>((resolve) => {
      calls.push(options);
      release = resolve;
      options.signal?.addEventListener('abort', () => resolve(null));
    });
});

afterEach(async () => {
  await f?.cleanup();
  rmSync(repo, { recursive: true, force: true });
});

describe('Terminal sessions open before their dependencies are ready', () => {
  it('starts the agent in the new worktree while dependencies are still preparing', async () => {
    const started = await f.launch();
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(worktree()).toContain(join(repo, '.spark', 'worktrees'));
    expect(started.connection.cwd).toBe(worktree());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(await dependencies()).toEqual(PREPARING);
    release(prepared);
    await vi.waitFor(async () => expect(await dependencies()).toBeNull());
    expect(f.startLines.at(-1)).toMatch(
      /^Terminal dependencies session=[0-9a-f-]{36} outcome=prepared method=clone total_ms=\d+$/,
    );
    expect(existsSync((await pendingDir(worktree()))!)).toBe(false);
  });

  it('keeps the session running and says so when preparing dependencies fails', async () => {
    await f.launch();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const note = 'Dependencies in this chat’s copy are out of date and installing them failed.';
    release({ ...prepared, method: 'skipped', stale: true, note });
    await vi.waitFor(async () =>
      expect(await dependencies()).toEqual({ state: 'failed', step: null, note }),
    );
    expect((await f.runtime.get(f.conversationId))?.state).toBe('unknown');
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.startLines.at(-1)).toContain('outcome=failed method=skipped');
  });

  it('ends the step when the session is stopped, and the next start prepares again', async () => {
    await f.launch();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const marker = (await pendingDir(worktree()))!;
    await f.runtime.stop(f.conversationId);
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(await dependencies()).toBeNull();
    expect(existsSync(marker)).toBe(true);
    expect(f.startLines.filter((line) => line.startsWith('Terminal dependencies'))).toEqual([
      expect.stringMatching(/ outcome=stopped method=none total_ms=\d+$/),
    ]);
    await f.runtime.launch(f.conversationId, { prompt: 'Again', resume: false });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(await dependencies()).toEqual(PREPARING);
    release(prepared);
    await vi.waitFor(async () => expect(await dependencies()).toBeNull());
    expect(existsSync(marker)).toBe(false);
    await f.runtime.stop(f.conversationId);
    await f.runtime.launch(f.conversationId, { prompt: 'Once more', resume: false });
    expect(calls).toHaveLength(2);
  });

  it('ends the step when Spark quits, and a start after the restart prepares again', async () => {
    await f.launch();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await f.restart();
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(await dependencies()).toBeNull();
    await f.runtime.launch(f.conversationId, { prompt: 'Again', resume: false });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(await dependencies()).toEqual(PREPARING);
  });
});
