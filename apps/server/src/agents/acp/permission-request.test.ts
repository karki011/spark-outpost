import { describe, expect, it } from 'vitest';
import { decodeClaudePermissionResponse } from '@agentclientprotocol/claude-agent-acp/dist/permissions/response.js';
import { approvalRequestFrom, permissionResponse } from './permission-request.ts';

const context = {
  rpcId: '12',
  roots: [{ path: '/work/app', ignore: [] }],
  cwd: '/work/app',
  home: '/Users/me',
};

const options = [
  { optionId: 'allow', name: 'Yes', kind: 'allow_once' as const },
  { optionId: 'always', name: 'Always', kind: 'allow_always' as const },
  { optionId: 'no', name: 'No', kind: 'reject_once' as const },
];

const exitPlanOptions = [
  { optionId: 'exit-plan-clear-auto', name: 'Yes, clear context', kind: 'allow_always' as const },
  { optionId: 'exit-plan-auto', name: 'Yes, and use auto mode', kind: 'allow_always' as const },
  {
    optionId: 'exit-plan-default',
    name: 'Yes, manually approve edits',
    kind: 'allow_once' as const,
  },
  { optionId: 'reject', name: 'No, keep planning', kind: 'reject_once' as const },
];

describe('approvalRequestFrom', () => {
  const asked = (command: unknown) =>
    approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: { toolCallId: 'a', title: 'Run command', kind: 'execute', rawInput: { command } },
        options,
      },
      context,
    ).command;

  it('reads a script Codex sends quoted as one shell word as the script itself', () => {
    expect(asked(`"pwd && rg --files -g '"'!**/.env'"' -g '"'!**/.env.*'"' | head -80"`)).toBe(
      "pwd && rg --files -g '!**/.env' -g '!**/.env.*' | head -80",
    );
    expect(asked(`"sed -n '1,160p' README.md && node --version"`)).toBe(
      "sed -n '1,160p' README.md && node --version",
    );
    expect(asked(`"rm -rf /etc/x && echo \\"done\\""`)).toBe('rm -rf /etc/x && echo "done"');
    expect(asked(`'git push --force origin main'`)).toBe('git push --force origin main');
  });

  it('leaves every other command as the agent sent it', () => {
    for (const command of [
      'npm test',
      'git diff --check && git status --short',
      `/bin/zsh -lc "sed -n '1,160p' package.json"`,
      `"quoted" plain`,
      `echo "a b"`,
      `"node"`,
    ]) {
      expect(asked(command)).toBe(command);
    }
  });

  it("keeps the agent's own reason for asking", () => {
    const request = (description: unknown) =>
      approvalRequestFrom(
        {
          sessionId: 's',
          toolCall: { toolCallId: 'a', title: 'curl example.com', kind: 'execute' },
          options,
          _meta: { permission: { version: 1, title: 'curl example.com', description } },
        },
        context,
      );
    expect(request('Reason: The command needs the network').agentReason).toBe(
      'The command needs the network',
    );
    expect(request('command failed in sandbox; retry without it?').agentReason).toBe(
      'command failed in sandbox; retry without it?',
    );
    expect(request(undefined)).not.toHaveProperty('agentReason');
  });

  it('names the MCP server behind a tool call', () => {
    const claude = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: { toolCallId: 'a', title: 'mcp__linear__create_issue', kind: 'other' },
        options,
      },
      context,
    );
    const claudeMeta = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: {
          toolCallId: 'b',
          title: 'Create issue',
          kind: 'other',
          _meta: { claudeCode: { mcpServer: { name: 'jira', source: 'config' } } },
        },
        options,
      },
      context,
    );
    const codex = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: {
          toolCallId: 'c',
          title: 'MCP tool call approval',
          kind: 'execute',
          rawInput: { serverName: 'github' },
        },
        _meta: { is_mcp_tool_approval: true },
        options,
      },
      context,
    );
    const shell = approvalRequestFrom(
      { sessionId: 's', toolCall: { toolCallId: 'd', title: 'ls', kind: 'execute' }, options },
      context,
    );
    expect([claude, claudeMeta, codex, shell].map((request) => request.mcpServer)).toEqual([
      'linear',
      'jira',
      'github',
      undefined,
    ]);
  });

  it("carries Claude's plan and every option the agent offers", () => {
    const request = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: {
          toolCallId: 'toolu_plan',
          title: 'Approve Plan',
          kind: 'switch_mode',
          rawInput: { plan: '# Plan\n1. Add export' },
          content: [{ type: 'content', content: { type: 'text', text: 'shown text' } }],
        },
        options: exitPlanOptions,
      },
      context,
    );
    expect(request).toMatchObject({
      kind: 'other',
      toolKind: 'switch_mode',
      plan: '# Plan\n1. Add export',
      options: exitPlanOptions,
    });
  });

  it('maps a Claude Bash request to a command', () => {
    const request = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: {
          toolCallId: 'toolu_1',
          title: 'ls -la',
          kind: 'execute',
          rawInput: { command: 'ls -la', description: 'List files' },
        },
        options,
      },
      context,
    );
    expect(request).toMatchObject({
      toolCallId: 'toolu_1',
      rpcId: '12',
      kind: 'execute',
      command: 'ls -la',
      cwd: '/work/app',
      paths: [],
      options,
    });
  });

  it('maps an edit with a diff and a relative location to absolute paths', () => {
    const request = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: {
          toolCallId: 'toolu_2',
          title: 'Edit src/a.ts',
          kind: 'edit',
          rawInput: { file_path: '/work/app/src/a.ts', old_string: 'a', new_string: 'b' },
          content: [{ type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' }],
          locations: [{ path: '/work/app/src/a.ts' }],
        },
        options,
      },
      context,
    );
    expect(request).toMatchObject({
      kind: 'edit',
      command: null,
      paths: ['/work/app/src/a.ts'],
      diffs: [{ path: '/work/app/src/a.ts', oldText: 'a', newText: 'b' }],
    });
  });

  it('joins array commands and keeps unknown tools as other', () => {
    const codex = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: {
          toolCallId: 'c',
          title: 'Run',
          kind: 'execute',
          rawInput: { command: ['git', 'push'] },
        },
        options,
      },
      context,
    );
    expect(codex.command).toBe('git push');
    const other = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: { toolCallId: 'x', title: 'Fetch docs', kind: 'fetch' },
        options,
      },
      context,
    );
    expect(other).toMatchObject({ kind: 'other', toolKind: 'fetch', title: 'Fetch docs' });
  });

  it('drops option kinds it does not know', () => {
    const request = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: { toolCallId: 'x', title: 'Do it' },
        options: [...options, { optionId: 'odd', name: 'Odd', kind: 'something' as 'allow_once' }],
      },
      context,
    );
    expect(request.options).toEqual(options);
  });
});

describe('permissionResponse', () => {
  it('selects the answered option or cancels', () => {
    expect(
      permissionResponse({ outcome: 'selected', optionId: 'allow', allowed: true, note: '' }),
    ).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(permissionResponse({ outcome: 'cancelled', note: '' })).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  it("tells the agent when Spark's policy, not the user, rejected the call", () => {
    const denial = "Spark's policy blocked `pnpm add zod` (reason).";
    expect(
      permissionResponse({
        outcome: 'selected',
        optionId: 'reject',
        allowed: false,
        note: '',
        denial,
      }),
    ).toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
      _meta: { denyMessage: denial },
    });
  });

  it("reaches Claude as the tool's denial message instead of 'User refused'", () => {
    const offered = [{ optionId: 'reject', name: 'No', kind: 'reject_once' as const }];
    const decode = (denial?: string) =>
      decodeClaudePermissionResponse(
        permissionResponse({
          outcome: 'selected',
          optionId: 'reject',
          allowed: false,
          note: '',
          ...(denial ? { denial } : {}),
        }),
        'Bash',
        { command: 'pnpm add zod' },
        'tool-1',
        offered,
      ).permissionResult;
    expect(decode("Spark's policy blocked `pnpm add zod` (reason).")).toMatchObject({
      behavior: 'deny',
      message: "Spark's policy blocked `pnpm add zod` (reason).",
    });
    expect(decode()).toMatchObject({
      behavior: 'deny',
      message: 'User refused permission to run tool',
    });
  });
});
