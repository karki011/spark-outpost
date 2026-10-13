import { appendFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureLines } from './fixtures/terminal-usage/read.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
let folder: string;
beforeEach(async () => {
  f = await nativeRuntimeFixture({ realFiles: true });
  folder = await realpath(await mkdtemp(join(tmpdir(), 'spark-usage-files-')));
});
afterEach(async () => {
  await f?.cleanup();
  await rm(folder, { recursive: true, force: true });
});

const FIRST = 'bcdb90a6-b8e0-4239-acae-ecdf3f16e3a0';
const FIRST_PROMPT = '96fbfdd7-3a5b-4b4a-9a43-0a4b4f0f2f6b';
const first = () => fixtureLines('claude-pass-first-then-clear.jsonl');
const write = (path: string, lines: readonly string[]) =>
  appendFile(path, lines.map((line) => `${line}\n`).join(''));
const usage = () => f.runtime.usage(f.conversationId);

describe('native terminal usage read from real files', () => {
  it('keeps the usage of a first turn that is over before the file was polled', async () => {
    const path = join(folder, `${FIRST}.jsonl`);
    const lines = first();
    const promptId = (JSON.parse(lines[4]!) as { promptId: string }).promptId;
    expect(promptId.slice(0, 8)).toBe(FIRST_PROMPT.slice(0, 8));
    const session = { session_id: FIRST, transcript_path: path };
    await f.launch();
    await f.hook('SessionStart', session);
    await write(path, lines.slice(0, 4));
    await f.hook('UserPromptSubmit', { ...session, prompt: 'x', prompt_id: promptId });
    await write(path, lines.slice(4, 32));
    await f.hook('Stop', { ...session, prompt_id: promptId });
    expect((await usage()).turns.map((turn) => turn.tokens)).toMatchObject([
      { input: 2, output: 4, cachedRead: 28918, cachedWrite: 9426 },
    ]);
  });

  it('keeps usage that reaches the file only after the turn closed', async () => {
    const path = join(folder, `${FIRST}.jsonl`);
    const lines = first();
    const promptId = (JSON.parse(lines[4]!) as { promptId: string }).promptId;
    const session = { session_id: FIRST, transcript_path: path };
    await f.launch();
    await write(path, lines.slice(0, 4));
    await f.hook('SessionStart', session);
    await f.hook('UserPromptSubmit', { ...session, prompt: 'x', prompt_id: promptId });
    await f.hook('Stop', { ...session, prompt_id: promptId });
    await write(path, lines.slice(4));
    f.exits[0]!({ exitCode: 0 });
    await expect
      .poll(async () => (await usage()).turns[0]?.tokens)
      .toMatchObject({ input: 2, output: 4, cachedRead: 28918, cachedWrite: 9426 });
    expect((await usage()).reported.map((total) => total.costUsd)).toEqual([0.081407]);
  });

  it('keeps usage and the total when Stop ends the session right after a fast turn', async () => {
    const path = join(folder, `${FIRST}.jsonl`);
    const lines = first();
    const promptId = (JSON.parse(lines[4]!) as { promptId: string }).promptId;
    const session = { session_id: FIRST, transcript_path: path };
    await f.launch();
    await f.hook('SessionStart', session);
    await f.hook('UserPromptSubmit', { ...session, prompt: 'x', prompt_id: promptId });
    await write(path, lines.slice(0, 32));
    await f.hook('Stop', { ...session, prompt_id: promptId });
    await f.runtime.stop(f.conversationId);
    await write(path, lines.slice(32));
    f.exits[0]!({ exitCode: 129 });
    await expect
      .poll(async () => (await usage()).reported.map((total) => total.costUsd))
      .toEqual([0.081407]);
    expect((await usage()).turns[0]?.tokens).toMatchObject({ output: 4, cachedWrite: 9426 });
  });

  it('reads a fast first turn and the total at exit when the project folder appears after the prompt', async () => {
    const project = join(folder, 'new-project');
    const path = join(project, `${FIRST}.jsonl`);
    const lines = first();
    const promptId = (JSON.parse(lines[4]!) as { promptId: string }).promptId;
    const session = { session_id: FIRST, transcript_path: path };
    await f.launch();
    await f.hook('SessionStart', session);
    await f.hook('UserPromptSubmit', { ...session, prompt: 'x', prompt_id: promptId });
    await mkdir(project);
    await write(path, lines.slice(0, 32));
    await f.hook('Stop', { ...session, prompt_id: promptId });
    expect((await usage()).turns[0]?.tokens).toMatchObject({ output: 4, cachedWrite: 9426 });
    await f.runtime.stop(f.conversationId);
    await write(path, lines.slice(32));
    f.exits[0]!({ exitCode: 129 });
    await expect
      .poll(async () => (await usage()).reported.map((total) => total.costUsd))
      .toEqual([0.081407]);
  });

  it('keeps the earlier CLI session total after /clear and adds the new one', async () => {
    const SECOND = '36981cd7-48fa-45c1-84e3-5c169579724e';
    const path = join(folder, `${FIRST}.jsonl`);
    const next = join(folder, `${SECOND}.jsonl`);
    const lines = first();
    const later = fixtureLines('claude-pass-after-clear.jsonl');
    const promptId = (JSON.parse(lines[4]!) as { promptId: string }).promptId;
    const nextPrompt = (JSON.parse(later[6]!) as { promptId: string }).promptId;
    const session = { session_id: FIRST, transcript_path: path };
    const cleared = { session_id: SECOND, transcript_path: next };
    await f.launch();
    await f.hook('SessionStart', session);
    await f.hook('UserPromptSubmit', { ...session, prompt: 'x', prompt_id: promptId });
    await write(path, lines.slice(0, 32));
    await f.hook('Stop', { ...session, prompt_id: promptId });
    await f.hook('SessionEnd', { ...session, reason: 'clear' });
    await write(path, lines.slice(32));
    await f.hook('SessionStart', cleared);
    await write(next, later.slice(0, 6));
    await f.hook('UserPromptSubmit', { ...cleared, prompt: 'y', prompt_id: nextPrompt });
    await write(next, later.slice(6, 27));
    await f.hook('Stop', { ...cleared, prompt_id: nextPrompt });
    await write(next, later.slice(27));
    f.exits[0]!({ exitCode: 0 });
    await expect
      .poll(async () => (await usage()).reported.map((total) => total.costUsd))
      .toEqual([0.081407, 0.112064]);
    expect((await usage()).turns.map((turn) => turn.tokens?.cachedWrite)).toEqual([9426, 13258]);
  });

  it('reads once what was written after Spark stopped watching, when the session is looked at again', async () => {
    const path = join(folder, `${FIRST}.jsonl`);
    const lines = first();
    const promptId = (JSON.parse(lines[4]!) as { promptId: string }).promptId;
    const session = { session_id: FIRST, transcript_path: path };
    await f.launch();
    await f.hook('SessionStart', session);
    await f.hook('UserPromptSubmit', { ...session, prompt: 'x', prompt_id: promptId });
    await write(path, lines.slice(0, 32));
    await f.hook('Stop', { ...session, prompt_id: promptId });
    await f.runtime.stop(f.conversationId);
    await f.restart();
    await write(path, lines.slice(32));
    expect((await usage()).reported.map((total) => total.costUsd)).toEqual([0.081407]);
  });
});
