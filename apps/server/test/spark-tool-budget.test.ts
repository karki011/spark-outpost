import { describe, expect, it } from 'vitest';
import { advertisedSize, SESSION_CASES } from './spark-tool-sizes.ts';

const PLAIN_CHAT_MAX_CHARS = 28_800;
const INSTRUCTIONS_MAX_CHARS = 1_650;
const BROWSER_GROUP_MAX_CHARS = 7_700;
const ATLASSIAN_GROUPS_MAX_CHARS = 7_600;
const SERVICENOW_GROUP_MAX_CHARS = 3_000;
const ARTIFACT_TOOL_MAX_CHARS = 1_500;
const RULES_EDIT_TOOL_MAX_CHARS = 1_000;
const PLUGINS_EDIT_TOOL_MAX_CHARS = 500;
const CREW_TOOLS_MAX_CHARS = 1_300;
const CHAT_MESSAGES_TOOL_MAX_CHARS = 800;
const SUB_CHATS_TOOL_MAX_CHARS = 1_500;

describe('the size of the Spark tool list a session is sent', () => {
  it('stays within the budget for a plain chat with nothing connected', async () => {
    const size = await advertisedSize(SESSION_CASES['plain chat, nothing connected']);
    expect(size.chars).toBeLessThanOrEqual(PLAIN_CHAT_MAX_CHARS);
    expect(size.instructionChars).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
    expect(Object.keys(size.groups).sort()).toEqual([
      'artifacts',
      'chat_messages',
      'crew_edit',
      'crew_read',
      'mcp_servers',
      'other',
      'plugins_edit',
      'rules_edit',
      'sparks',
    ]);
    expect(size.groups.artifacts).toBeLessThanOrEqual(ARTIFACT_TOOL_MAX_CHARS);
    expect(size.groups.chat_messages).toBeLessThanOrEqual(CHAT_MESSAGES_TOOL_MAX_CHARS);
    expect(size.groups.rules_edit).toBeLessThanOrEqual(RULES_EDIT_TOOL_MAX_CHARS);
    expect(size.groups.plugins_edit).toBeLessThanOrEqual(PLUGINS_EDIT_TOOL_MAX_CHARS);
    expect(size.groups.crew_read! + size.groups.crew_edit!).toBeLessThanOrEqual(
      CREW_TOOLS_MAX_CHARS,
    );
  });

  it('adds the ticket tools and four Atlassian tools, within a budget sized for every Jira action a person can take, with Atlassian connected', async () => {
    const plain = await advertisedSize(SESSION_CASES['plain chat, nothing connected']);
    const atlassian = await advertisedSize(SESSION_CASES['plain chat, Atlassian connected']);
    expect(atlassian.tools - plain.tools).toBe(9);
    expect(atlassian.groups.jira! + atlassian.groups.confluence!).toBeLessThanOrEqual(
      ATLASSIAN_GROUPS_MAX_CHARS,
    );
    expect(atlassian.groups.other).toBe(plain.groups.other);
    expect(atlassian.instructionChars).toBeLessThan(plain.instructionChars);
  });

  it('adds three ticket tools and the two ServiceNow tools, within budget, with ServiceNow connected', async () => {
    const plain = await advertisedSize(SESSION_CASES['plain chat, nothing connected']);
    const serviceNow = await advertisedSize(SESSION_CASES['plain chat, ServiceNow connected']);
    expect(serviceNow.tools - plain.tools).toBe(6);
    expect(serviceNow.groups.ticket_create).toBeUndefined();
    expect(serviceNow.groups.servicenow).toBeLessThanOrEqual(SERVICENOW_GROUP_MAX_CHARS);
    expect(serviceNow.groups.other).toBe(plain.groups.other);
  });

  it('grows only by the groups a session can use', async () => {
    const plain = await advertisedSize(SESSION_CASES['plain chat, nothing connected']);
    const linked = await advertisedSize(SESSION_CASES['linked project, GitHub connected']);
    const everything = await advertisedSize(SESSION_CASES['everything connected, Browser pane']);
    expect(linked.chars - plain.chars).toBe(
      linked.groups.project! +
        linked.groups.publish! +
        linked.groups.pull_requests! +
        linked.groups.github! +
        linked.groups.sub_chats!,
    );
    expect(linked.groups.sub_chats).toBeLessThanOrEqual(SUB_CHATS_TOOL_MAX_CHARS);
    expect(everything.tools).toBeGreaterThan(linked.tools);
    expect(everything.groups.browser).toBeLessThanOrEqual(BROWSER_GROUP_MAX_CHARS);
    expect(everything.instructionChars).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
    expect(everything.groups.other).toBe(plain.groups.other);
  });
});
