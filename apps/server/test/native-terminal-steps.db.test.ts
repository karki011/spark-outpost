import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture();
});
afterEach(async () => {
  await f?.cleanup();
});

const tool = (name: string, tool_use_id: string, tool_name: string, prompt_id = 'first') =>
  f.hook(name, { prompt_id, tool_use_id, tool_name, tool_input: { command: 'cat .env' } });
const steps = async () => (await f.runtime.usage(f.conversationId)).turns.map((turn) => turn.steps);

describe('native terminal steps', () => {
  it('stores one step per tool call, paired by tool id', async () => {
    await f.launch();
    await f.hook('UserPromptSubmit', { prompt: 'Check the native fixture', prompt_id: 'first' });
    await tool('PreToolUse', 'toolu_a', 'Bash');
    await tool('PreToolUse', 'toolu_b', 'Read');
    await tool('PostToolUse', 'toolu_b', 'Read');
    await tool('PreToolUse', 'toolu_a', 'Bash');
    expect(await steps()).toMatchObject([
      [
        { id: 'toolu_a', name: 'Bash', endedAt: null, failed: false, agentId: null },
        { id: 'toolu_b', name: 'Read', endedAt: expect.any(String), failed: false },
      ],
    ]);
    await tool('PostToolUseFailure', 'toolu_a', 'Bash');
    await tool('PostToolUse', 'toolu_a', 'Bash');
    const first = (await steps())[0]![0]!;
    expect(first).toMatchObject({ id: 'toolu_a', failed: true, endedAt: expect.any(String) });
    expect(Date.parse(first.endedAt!)).toBeGreaterThanOrEqual(Date.parse(first.startedAt!));
  });

  it('keeps the name only, shows the steps as the turn activity and files them under their turn', async () => {
    await f.launch();
    await f.hook('UserPromptSubmit', { prompt: 'Check the native fixture', prompt_id: 'first' });
    await tool('PreToolUse', 'toolu_a', 'Bash');
    await tool('PostToolUse', 'toolu_a', 'Bash');
    await f.hook('Stop', { prompt_id: 'first' });
    await f.hook('UserPromptSubmit', { prompt: 'Again', prompt_id: 'second' });
    await f.hook('PreToolUse', {
      prompt_id: 'second',
      tool_use_id: 'toolu_c',
      tool_name: 'Grep',
      agent_id: 'agent-7',
    });
    await tool('PostToolUse', 'toolu_late', 'Bash', 'first');
    const usage = await f.runtime.usage(f.conversationId);
    expect(usage.provider).toBe('claude');
    expect(usage.turns.map((turn) => turn.steps.map((step) => [step.name, step.agentId]))).toEqual([
      [['Bash', null]],
      [['Grep', 'agent-7']],
    ]);
    const stored = await f.t.db.query('SELECT * FROM native_terminal_steps');
    expect(JSON.stringify(stored.rows)).not.toContain('cat .env');
    const detail = await getConversationDetail(f.t.db, f.conversationId);
    expect(Object.values(detail!.activity)).toEqual([
      [{ name: 'Running a command', done: true }],
      [{ name: 'Searching files', done: false, subagent: true }],
    ]);
  });

  it('stores nothing for a tool event without a tool id, and an end without a start has no start time', async () => {
    await f.launch();
    await f.hook('UserPromptSubmit', { prompt: 'Check the native fixture', prompt_id: 'first' });
    await f.hook('PreToolUse', { prompt_id: 'first', tool_name: 'Bash' });
    await f.hook('PostToolUse', { prompt_id: 'first', tool_name: 'Bash' });
    expect(await steps()).toEqual([[]]);
    await tool('PostToolUse', 'toolu_only_end', 'Edit');
    expect(await steps()).toMatchObject([
      [{ id: 'toolu_only_end', startedAt: null, endedAt: expect.any(String) }],
    ]);
  });
});
