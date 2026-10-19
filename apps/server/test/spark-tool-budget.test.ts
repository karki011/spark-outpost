import { describe, expect, it } from 'vitest';
import { advertisedSize, SESSION_CASES } from './spark-tool-sizes.ts';

const PLAIN_CHAT_MAX_CHARS = 27_000;
const INSTRUCTIONS_MAX_CHARS = 1_700;
const BROWSER_GROUP_MAX_CHARS = 7_500;
const ATLASSIAN_GROUPS_MAX_CHARS = 4_600;

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

  it('adds the ticket tools and four Atlassian tools, within budget, with Atlassian connected', async () => {
    const plain = await advertisedSize(SESSION_CASES['plain chat, nothing connected']);
    const atlassian = await advertisedSize(SESSION_CASES['plain chat, Atlassian connected']);
    expect(atlassian.tools - plain.tools).toBe(9);
    expect(atlassian.groups.jira! + atlassian.groups.confluence!).toBeLessThanOrEqual(
      ATLASSIAN_GROUPS_MAX_CHARS,
    );
    expect(atlassian.groups.other).toBe(plain.groups.other);
    expect(atlassian.instructionChars).toBeLessThan(plain.instructionChars);
  });

  it('grows only by the groups a session can use', async () => {
    const plain = await advertisedSize(SESSION_CASES['plain chat, nothing connected']);
    const linked = await advertisedSize(SESSION_CASES['linked project, GitHub connected']);
    const everything = await advertisedSize(SESSION_CASES['everything connected, Browser pane']);
    expect(linked.chars - plain.chars).toBe(
      linked.groups.project! +
        linked.groups.publish! +
        linked.groups.pull_requests! +
        linked.groups.outpost_draft!,
    );
    expect(everything.tools).toBeGreaterThan(linked.tools);
    expect(everything.groups.browser).toBeLessThanOrEqual(BROWSER_GROUP_MAX_CHARS);
    expect(everything.instructionChars).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
    expect(everything.groups.other).toBe(plain.groups.other);
  });
});
