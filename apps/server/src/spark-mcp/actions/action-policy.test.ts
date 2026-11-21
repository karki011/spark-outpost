import { describe, expect, it } from 'vitest';
import { actionPath, askedToSend, explicitlyAsked, type ActionFacts } from './action-policy.ts';

const facts = (overrides: Partial<ActionFacts>): ActionFacts => ({
  posture: 'asks',
  requested: false,
  ...overrides,
});

describe('actionPath', () => {
  it.each([
    ['auto', 'perform'],
    ['full_access', 'perform'],
    ['asks', 'confirm'],
    ['read_only', 'confirm'],
    ['denies', 'confirm'],
    ['unknown', 'confirm'],
    ['edits', 'confirm'],
  ] as const)('in a %s mode it chooses %s', (posture, path) => {
    expect(actionPath(facts({ posture }))).toBe(path);
  });

  it('performs in Accept edits only when the user asked', () => {
    expect(actionPath(facts({ posture: 'edits', requested: true }))).toBe('perform');
    expect(actionPath(facts({ posture: 'asks', requested: true }))).toBe('confirm');
  });
});

describe('explicitlyAsked', () => {
  it.each([
    ['open_pr', 'open pr', true],
    ['open_pr', 'Open PR', true],
    ['open_pr', 'please create a pull request for this', true],
    ['open_pr', 'what does this PR change?', false],
    ['open_pr', 'fix the filter bug', false],
    ['post_slack', 'fix it and post an update to the Slack channel', true],
    ['post_slack', 'reply in the thread when done', true],
    ['post_slack', 'read the Slack thread and fix the bug', false],
    ['post_slack', 'what did the channel say?', false],
    ['create_ticket', 'file a bug for the crash', true],
    ['create_ticket', 'look at the ticket', false],
    ['transition_ticket', 'move ENG-12 to done', true],
    ['assign_ticket', 'assign it to me', true],
    ['pr_follow_up', 'open pr', false],
    ['add_mcp_server', 'add the GitHub MCP server', true],
    ['add_mcp_server', 'set up an mcp for Slack', true],
    ['add_mcp_server', 'which MCP servers do I have?', false],
    ['update_mcp_server', 'point the docs MCP server at staging', true],
    ['switch_mcp_server', 'turn off the files mcp for this chat', true],
    ['remove_mcp_server', 'remove the old MCP server', true],
    ['remove_mcp_server', 'add an MCP server', false],
    ['calendar_read', "what's on my calendar tomorrow", true],
    ['calendar_read', 'am I free at 3?', true],
    ['calendar_read', 'fix the calendar view bug', false],
    ['calendar_edit', 'add an event called Spark 1b test tomorrow at 15:00', true],
    ['calendar_edit', 'create "Spark 1b test" tomorrow at 15:00 on Spark Test', true],
    ['calendar_edit', 'move the header 10px to the left', false],
    ['calendar_edit', 'move the standup to 11', false],
    ['calendar_edit', 'move that event to 17:00', true],
    ['calendar_edit', 'delete the meeting', true],
    ['calendar_edit', "what's on my calendar tomorrow", false],
    ['start_sub_chats', 'Split this into sub-chats', true],
    ['start_sub_chats', 'spin up three sub-tasks for this', true],
    ['start_sub_chats', 'kick off separate chats for the api and the page', true],
    ['start_sub_chats', 'fix the sub-chat tree', false],
    ['start_sub_chats', 'create a chat title helper', false],
    ['stop_sub_chat', 'stop the Orders page sub-chat', true],
    ['stop_sub_chat', 'cancel that chat, it is going the wrong way', true],
    ['stop_sub_chat', 'the chat should stop flickering', false],
    ['send_to_chat', 'tell the billing chat to rebase', true],
    ['send_to_chat', 'ask the other sub-chat for its schema', true],
    ['send_to_chat', 'fix the chat header', false],
  ] as const)('%s for "%s" is %s', (action, request, expected) => {
    expect(explicitlyAsked(action, request)).toBe(expected);
  });
});

describe('askedToSend', () => {
  const title = 'Billing export';

  it.each([
    ['Tell Billing export to rebase on main.', true],
    ['Fix the totals, then ask Billing export which column it reads.', true],
    ['please message billing export that the schema changed', true],
    ['Tell the other chat to rebase on main.', false],
    ['Should I tell Billing export to rebase?', false],
    ['Don’t tell Billing export about this yet.', false],
    ['Never message Billing export.', false],
    ['Billing export is the chat that reads this file.', false],
    ['Tell Billing to rebase.', false],
  ])('for "%s" is %s', (request, expected) => {
    expect(askedToSend(request, title)).toBe(expected);
  });

  it('needs the chat named in the sentence that asks', () => {
    expect(askedToSend('Billing export is busy. Tell it to rebase.', title)).toBe(false);
  });

  const file = 'Create notes.txt containing hello';
  const plain = 'Add function B';

  it.each([
    [`Ask the chat "${file}" what file it changed, and wait for its reply.`, file, true],
    [`Ask the chat "${file}" what file it changed`, file, true],
    [`Ask the chat "${plain}" what file it changed, and wait for its reply.`, plain, true],
    [`Ask the chat "${plain}" what file it changed`, plain, true],
    [`Ask the chat ${plain} what file it changed and report back`, plain, true],
    [`Ask the chat ${plain} what file it changed, and tell me the reply`, plain, true],
    [`Ask ${plain} which file it changed, then wait until it answers.`, plain, true],
    [`Tidy up. Then message ${file} that main moved. Thanks.`, file, true],
    ['Tell Stop the flaky wait loop to rebase.', 'Stop the flaky wait loop', true],
    [`Don't message ${plain}.`, plain, false],
    [`Don’t ask ${file} anything.`, file, false],
    [`Wait before you ask ${plain} what it changed.`, plain, false],
    [`Wait, then ask ${plain} what it changed.`, plain, false],
    [`Ask ${plain} what it changed, but wait for me.`, plain, false],
    [`Ask ${plain} what it changed, and wait for its reply, but not yet.`, plain, false],
    [`Ask ${plain} what it changed once the tests pass, not before.`, plain, false],
    [`Should I ask ${file} what it changed?`, file, false],
    [`The notes.txt file is wrong. Ask the other chat about it.`, file, false],
  ])('for "%s" naming "%s" is %s', (request, named, expected) => {
    expect(askedToSend(request, named)).toBe(expected);
  });

  it('does not let a masked longer title stand in for a chat named like the mask’s words', () => {
    expect(askedToSend('Tell Chat v2 to rebase.', 'Chat', ['Chat v2'])).toBe(false);
    expect(askedToSend('Tell Chat v2 to rebase.', 'other', ['Chat v2'])).toBe(false);
    expect(askedToSend('Tell Chat to rebase.', 'Chat', ['Chat v2'])).toBe(true);
  });

  it.each([
    ['Wait until it responds, then message Billing export the result.', false],
    ['Wait for its reply and then tell Billing export to rebase.', false],
    ['Tell Billing export to rebase and wait for its reply.', true],
    ['Tell Billing export to rebase, then wait until it answers.', true],
  ])('keeps a wait that comes before the send: "%s" is %s', (request, expected) => {
    expect(askedToSend(request, title)).toBe(expected);
  });

  it('does not take a longer chat title for the shorter one inside it', () => {
    const longer = ['Billing export v2'];
    expect(askedToSend('Tell Billing export v2 to rebase.', title, longer)).toBe(false);
    expect(askedToSend('Tell Billing export v2 to rebase.', 'Billing export v2', [])).toBe(true);
    expect(askedToSend('Tell Billing export to rebase.', title, longer)).toBe(true);
    expect(
      askedToSend('Tell Billing export v2 to rebase, and tell Billing export too.', title, longer),
    ).toBe(true);
  });
});
