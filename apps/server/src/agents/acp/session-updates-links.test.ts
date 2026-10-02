import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { createUpdateMapper, opensPullRequest } from './session-updates.ts';

const link = (uri: string, name: string): SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'resource_link', uri, name },
});

describe('pull request links', () => {
  it('captures the pull request a PR-creating tool opened, and shared resource links, once', () => {
    const mapper = createUpdateMapper();
    const pr = 'https://github.com/o/r/pull/12';
    expect(
      mapper.map({
        sessionUpdate: 'tool_call',
        toolCallId: 'gh',
        title: 'gh pr create',
        status: 'in_progress',
        content: [{ type: 'content', content: { type: 'text', text: `Created ${pr}\n` } }],
      }),
    ).toEqual([
      { kind: 'step_started', name: 'gh pr create', tool: true },
      { kind: 'link', url: pr, title: 'o/r#12', source: 'tool_output' },
    ]);
    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'gh',
        status: 'completed',
        rawOutput: { stdout: `${pr}\nhttps://github.com/o/r/pull/13` },
      }),
    ).toEqual([expect.objectContaining({ kind: 'step_finished', name: 'gh pr create' })]);
    expect(mapper.map(link('https://github.com/o/r/pull/14', 'PR 14'))).toEqual([
      {
        kind: 'link',
        url: 'https://github.com/o/r/pull/14',
        title: 'o/r#14',
        source: 'resource_link',
      },
      { kind: 'text_delta', delta: '[PR 14](https://github.com/o/r/pull/14)' },
    ]);
  });

  it('ignores pull requests that tools only list or mention', () => {
    const mapper = createUpdateMapper();
    const listing = JSON.stringify({
      pulls: [
        { url: 'https://github.com/o/r/pull/2177' },
        { url: 'https://github.com/o/r/pull/2176' },
      ],
    });
    mapper.map({
      sessionUpdate: 'tool_call',
      toolCallId: 'list',
      title: 'mcp__spark__spark_pull_requests',
      status: 'pending',
      rawInput: {},
    });
    const outputs = mapper.map({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'list',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: listing } }],
      rawOutput: listing,
    });
    expect(outputs.filter((output) => output.kind === 'link')).toEqual([]);
  });

  it('records the link once the streamed input shows the tool opens a pull request', () => {
    const mapper = createUpdateMapper();
    mapper.map({
      sessionUpdate: 'tool_call',
      toolCallId: 'bash',
      title: 'Terminal',
      status: 'pending',
      rawInput: {},
    });
    const outputs = mapper.map({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'bash',
      status: 'completed',
      rawInput: { command: 'gh pr create --fill' },
      rawOutput: 'https://github.com/o/r/pull/21\n',
    });
    expect(outputs.filter((output) => output.kind === 'link')).toEqual([
      {
        kind: 'link',
        url: 'https://github.com/o/r/pull/21',
        title: 'o/r#21',
        source: 'tool_output',
      },
    ]);
  });

  it('knows which tool calls open a pull request', () => {
    expect(opensPullRequest('gh pr create --fill', {})).toBe(true);
    expect(opensPullRequest('Terminal', { command: 'gh pr list' })).toBe(false);
    expect(opensPullRequest('mcp__github__create_pull_request', {})).toBe(true);
    expect(opensPullRequest('mcp__spark__spark_pull_requests', { limit: 10 })).toBe(false);
  });
});
