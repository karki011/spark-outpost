import { describe, expect, it } from 'vitest';
import { transcriptItems } from './transcript-items.ts';

const line = (record: object) => JSON.stringify(record);

describe('Claude session file', () => {
  const lines = [
    line({ type: 'permission-mode', permissionMode: 'default' }),
    line({
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-10-14T10:00:00Z',
      message: { role: 'user', content: 'Add a test for the parser' },
    }),
    line({
      type: 'user',
      uuid: 'u0',
      message: { role: 'user', content: '<command-name>/clear</command-name>' },
    }),
    line({
      type: 'assistant',
      uuid: 'a1',
      message: { id: 'm1', role: 'assistant', content: [{ type: 'thinking', thinking: 'secret' }] },
    }),
    line({
      type: 'assistant',
      uuid: 'a2',
      message: {
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Reading it first.' }],
      },
    }),
    line({
      type: 'assistant',
      uuid: 'a3',
      message: {
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' } }],
      },
    }),
    line({
      type: 'user',
      uuid: 'r1',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    }),
    line({
      type: 'assistant',
      uuid: 'a4',
      isSidechain: true,
      message: { id: 'm9', role: 'assistant', content: [{ type: 'text', text: 'sub-agent' }] },
    }),
    line({
      type: 'assistant',
      uuid: 'a5',
      message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    }),
    line({
      type: 'assistant',
      uuid: 'a6',
      message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'All green.' }] },
    }),
    line({
      type: 'user',
      uuid: 'i1',
      message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    }),
    'not json',
  ];

  it('shows prompts, replies and tool calls, and leaves out thinking, results and sub-agents', () => {
    expect(
      transcriptItems('claude', lines).map(({ kind, text, tool }) => ({ kind, text, tool })),
    ).toEqual([
      { kind: 'user', text: 'Add a test for the parser', tool: null },
      { kind: 'assistant', text: 'Reading it first.', tool: null },
      { kind: 'tool', text: 'pnpm test', tool: 'Bash' },
      { kind: 'assistant', text: 'Done.\n\nAll green.', tool: null },
      { kind: 'interrupt', text: 'Interrupted', tool: null },
    ]);
  });
});

describe('Codex session file', () => {
  const lines = [
    line({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>…</environment_context>' }],
      },
    }),
    line({
      type: 'event_msg',
      timestamp: '2026-10-14T10:00:00Z',
      payload: {
        type: 'item_completed',
        item: { type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'Fix the build' }] },
      },
    }),
    line({
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: 'f1',
        name: 'shell',
        arguments: JSON.stringify({ cmd: 'pnpm build' }),
      },
    }),
    line({
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        id: 'c1',
        name: 'apply_patch',
        input: '*** Begin Patch',
      },
    }),
    line({
      type: 'event_msg',
      payload: { type: 'item_completed', item: { type: 'AgentMessage', id: 'x', content: [] } },
    }),
    line({
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Fixed.' }],
      },
    }),
    line({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'Fixed.' } }),
    line({ type: 'event_msg', payload: { type: 'turn_aborted', reason: 'interrupted' } }),
  ];

  it('takes the typed message, tool calls and each reply once', () => {
    expect(
      transcriptItems('codex', lines).map(({ kind, text, tool }) => ({ kind, text, tool })),
    ).toEqual([
      { kind: 'user', text: 'Fix the build', tool: null },
      { kind: 'tool', text: 'pnpm build', tool: 'shell' },
      { kind: 'tool', text: '*** Begin Patch', tool: 'apply_patch' },
      { kind: 'assistant', text: 'Fixed.', tool: null },
      { kind: 'interrupt', text: 'Interrupted', tool: null },
    ]);
  });
});

describe('long content', () => {
  it('shortens a reply and a tool detail', () => {
    const [reply] = transcriptItems('claude', [
      line({
        type: 'assistant',
        message: { id: 'm', content: [{ type: 'text', text: 'x'.repeat(9_000) }] },
      }),
    ]);
    expect(reply!.text).toHaveLength(8_000);
    expect(reply!.text.endsWith('…')).toBe(true);
    expect(reply!.clipped).toBe(true);
  });

  it('marks a reply clipped once its joined parts pass the limit, and adds nothing after', () => {
    const part = (text: string) =>
      line({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text }] } });
    const short = transcriptItems('claude', [part('Short.'), part('Still short.')]);
    expect(short).toMatchObject([{ text: 'Short.\n\nStill short.', clipped: false }]);
    const [long] = transcriptItems('claude', [
      part('a'.repeat(5_000)),
      part('b'.repeat(5_000)),
      part('the end'),
    ]);
    expect(long).toMatchObject({ clipped: true });
    expect(long!.text).toHaveLength(8_000);
    expect(long!.text).not.toContain('the end');
  });
});
