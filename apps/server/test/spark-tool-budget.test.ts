import { describe, expect, it } from 'vitest';
import { advertisedSize, SESSION_CASES } from './spark-tool-sizes.ts';

const PLAIN_CHAT_MAX_CHARS = 27_000;
const INSTRUCTIONS_MAX_CHARS = 1_700;

describe('the size of the Spark tool list a session is sent', () => {
  it('stays within the budget for a plain chat with nothing connected', async () => {
    const size = await advertisedSize(SESSION_CASES['plain chat, nothing connected']);
    expect(size.chars).toBeLessThanOrEqual(PLAIN_CHAT_MAX_CHARS);
    expect(size.instructionChars).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
    expect(Object.keys(size.groups).sort()).toEqual(['mcp_servers', 'other', 'sparks']);
  });

  it('adds the outpost tools only for a chat that can use them', async () => {
    const plain = await advertisedSize(SESSION_CASES['plain chat, nothing connected']);
    const member = await advertisedSize(SESSION_CASES['chat in an outpost, nothing connected']);
    expect(member.tools - plain.tools).toBe(4);
    expect(member.chars - plain.chars).toBe(member.groups.outpost! + member.groups.outpost_draft!);
    expect(member.groups.other).toBe(plain.groups.other);
    expect(member.instructionChars).toBeGreaterThan(plain.instructionChars);
  });

  it('grows only by the groups a session can use', async () => {
    const plain = await advertisedSize(SESSION_CASES['plain chat, nothing connected']);
    const linked = await advertisedSize(SESSION_CASES['linked project, GitHub connected']);
    const everything = await advertisedSize(SESSION_CASES['everything connected, Browser pane']);
    expect(linked.chars - plain.chars).toBe(
      linked.groups.project! + linked.groups.publish! + linked.groups.pull_requests!,
    );
    expect(everything.tools).toBeGreaterThan(linked.tools);
    expect(everything.groups.other).toBe(plain.groups.other);
  });
});
