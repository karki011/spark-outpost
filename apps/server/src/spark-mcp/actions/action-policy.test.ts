import { describe, expect, it } from 'vitest';
import { actionPath, explicitlyAsked, type ActionFacts } from './action-policy.ts';

const facts = (overrides: Partial<ActionFacts>): ActionFacts => ({
  posture: 'asks',
  level: 'hands-off',
  requested: false,
  observed: false,
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

  it('performs at Full auto → PR in any mode', () => {
    expect(actionPath(facts({ posture: 'read_only', level: 'full-auto' }))).toBe('perform');
  });

  it('performs in Accept edits only when the user asked', () => {
    expect(actionPath(facts({ posture: 'edits', requested: true }))).toBe('perform');
    expect(actionPath(facts({ posture: 'asks', requested: true }))).toBe('confirm');
  });

  it('always confirms after the run read sensitive data', () => {
    expect(actionPath(facts({ posture: 'full_access', level: 'full-auto', observed: true }))).toBe(
      'confirm',
    );
  });
});

describe('explicitlyAsked', () => {
  it.each([
    ['open_pr', 'open pr', true],
    ['open_pr', 'Open PR', true],
    ['open_pr', 'please create a pull request for this', true],
    ['open_pr', 'what does this PR change?', false],
    ['open_pr', 'fix the filter bug', false],
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
  ] as const)('%s for "%s" is %s', (action, request, expected) => {
    expect(explicitlyAsked(action, request)).toBe(expected);
  });
});
