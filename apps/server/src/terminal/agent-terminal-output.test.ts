import { describe, expect, it } from 'vitest';
import { AGENT_TERMINAL_STORED_CHARS } from '@spark-outpost/contracts';
import { AGENT_TERMINAL_REPLAY_CHARS, createAgentTerminalRecord } from './agent-terminal-output.ts';

const ESC = '\u001b';
const BEL = '\u0007';

describe('the record of an agent terminal', () => {
  it('keeps the text and counts it', () => {
    const record = createAgentTerminalRecord([]);
    record.push('ready on 5173\n');
    record.push('watching\n');
    record.finish();
    expect(record.tail).toBe('ready on 5173\nwatching\n');
    expect(record.total).toBe(23);
  });

  it('hides a known secret value, also when it arrives in two pieces', () => {
    const record = createAgentTerminalRecord(['hunter2-value-9']);
    record.push('token hunter2-va');
    record.push('lue-9 used\n');
    record.finish();
    expect(record.tail).not.toContain('hunter2-value-9');
    expect(record.tail).toContain('used');
  });

  it('hides a secret-looking assignment the way a recorded command does', () => {
    const record = createAgentTerminalRecord([]);
    record.push('API_KEY=sk-live-0123456789abcdef0123\n');
    record.finish();
    expect(record.tail).not.toContain('sk-live-0123456789abcdef0123');
  });

  it('drops sequences that would write the clipboard or the title from the saved text', () => {
    const record = createAgentTerminalRecord([]);
    record.push(`a${ESC}]52;c;c3RvbGVu${BEL}${ESC}]0;title${BEL}b\n`);
    record.finish();
    expect(record.tail).toBe('ab\n');
  });

  it('holds back an unfinished line until the end', () => {
    const record = createAgentTerminalRecord([]);
    record.push('Authorization: Bearer abcdef0123456789abcdef0123456789');
    expect(record.tail).toBe('');
    record.finish();
    expect(record.tail).not.toContain('abcdef0123456789');
    expect(record.total).toBe(record.tail.length);
  });

  it('saves only the end of long output and still counts all of it', () => {
    const record = createAgentTerminalRecord([]);
    const line = `${'x'.repeat(99)}\n`;
    for (let index = 0; index < 1_000; index += 1) record.push(line);
    record.finish();
    expect(record.total).toBe(100_000);
    expect(record.tail.length).toBeLessThanOrEqual(AGENT_TERMINAL_STORED_CHARS);
    expect(record.tail.endsWith(line)).toBe(true);
  });

  it('keeps what the process printed, as printed, for a tab that opens later', () => {
    const record = createAgentTerminalRecord([]);
    const coloured = `${ESC}[32mok${ESC}[0m\r\n`;
    record.push(coloured);
    expect(record.replay).toBe(coloured);
    record.push('y'.repeat(AGENT_TERMINAL_REPLAY_CHARS));
    expect(record.replay).toHaveLength(AGENT_TERMINAL_REPLAY_CHARS);
  });
});
