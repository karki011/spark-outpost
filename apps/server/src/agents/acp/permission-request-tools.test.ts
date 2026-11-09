import { describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk/unstable';
import { buildClaudePermissionPresentation } from '@agentclientprotocol/claude-agent-acp/dist/permissions/presentation.js';
import { readingTurnReviews } from './do-handlers.ts';
import { approvalRequestFrom } from './permission-request.ts';

const context = {
  rpcId: '7',
  roots: [{ path: '/work/app', ignore: [] }],
  cwd: '/work/app',
  home: '/Users/me',
};

function asked(toolName: string, input: Record<string, unknown>): acp.RequestPermissionRequest {
  const { toolCall } = buildClaudePermissionPresentation({
    toolName,
    input,
    toolUseID: `toolu_${toolName}`,
    cwd: '/work/app',
  });
  return {
    sessionId: 's',
    toolCall: toolCall as acp.ToolCallUpdate,
    options: [{ optionId: 'allow', name: 'Yes', kind: 'allow_once' }],
  };
}

describe('Claude tools the adapter shows as "other"', () => {
  it('reads a NotebookEdit as an edit of the notebook, so the floor sees its path', () => {
    const request = approvalRequestFrom(
      asked('NotebookEdit', { notebook_path: '/work/app/CLAUDE.md', new_source: 'x' }),
      context,
    );
    expect(request).toMatchObject({ kind: 'edit', paths: ['/work/app/CLAUDE.md'], command: null });
  });

  it("reads a Monitor's command as a command the gate can judge", () => {
    const request = approvalRequestFrom(
      asked('Monitor', { description: 'push', timeout_ms: 1000, command: 'git push --force' }),
      context,
    );
    expect(request).toMatchObject({
      kind: 'execute',
      command: 'git push --force',
      cwd: '/work/app',
    });
    expect(request).not.toHaveProperty('address');
  });

  it("reads a Monitor's socket and a WebFetch's page as web addresses", () => {
    const socket = approvalRequestFrom(
      asked('Monitor', {
        description: 'feed',
        timeout_ms: 1000,
        ws: { url: 'ws://127.0.0.1:9/x' },
      }),
      context,
    );
    expect(socket).toMatchObject({ kind: 'other', address: 'ws://127.0.0.1:9/x' });
    const page = approvalRequestFrom(
      asked('WebFetch', { url: 'https://docs.example.com/a', prompt: 'summary' }),
      context,
    );
    expect(page).toMatchObject({
      kind: 'other',
      toolKind: 'fetch',
      address: 'https://docs.example.com/a',
      title: 'Fetch https://docs.example.com/a',
    });
  });

  it('sends web tools and Monitor to the gate in a reading turn, and nothing else new', () => {
    expect(readingTurnReviews(asked('WebFetch', { url: 'https://a.example', prompt: 'p' }))).toBe(
      true,
    );
    expect(readingTurnReviews(asked('WebSearch', { query: 'spark outpost' }))).toBe(true);
    expect(readingTurnReviews(asked('Monitor', { description: 'd', command: 'ls' }))).toBe(true);
    expect(readingTurnReviews(asked('Bash', { command: 'ls' }))).toBe(true);
    expect(
      readingTurnReviews(
        asked('Edit', { file_path: '/work/app/a', old_string: 'a', new_string: 'b' }),
      ),
    ).toBe(false);
    expect(readingTurnReviews(asked('mcp__echo__echo', { text: 'hi' }))).toBe(false);
  });
});
