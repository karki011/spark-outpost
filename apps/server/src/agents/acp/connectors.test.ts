import { describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import type { ProtocolEntry } from '../../audit/protocol-entry.ts';
import { createReviewTracker } from '../../audit/review-tracker.ts';
import { createAuditRecorder } from '../../workflow/audit-recorder.ts';
import { agentDefinitions, codexConfig } from './agents.ts';
import { approvalRequestFrom } from './permission-request.ts';

interface CodexShape {
  features: Record<string, boolean>;
}

function claudeOptions(meta: Record<string, unknown> | undefined) {
  const claudeCode = meta?.claudeCode as { options: Record<string, unknown> };
  return claudeCode.options as { strictMcpConfig: boolean; settings: Record<string, unknown> };
}

describe("the user's own connectors in a chat session Spark starts", () => {
  it('are off in every Codex session: chat, project, with and without permission profiles', () => {
    const shapes = [
      codexConfig(false, null),
      codexConfig(true, null),
      codexConfig(true, null, false),
      codexConfig(true, { developerInstructions: 'x', agentsMd: true, skills: true }),
    ] as CodexShape[];
    for (const shape of shapes) expect(shape.features.apps).toBe(false);
    const env = agentDefinitions.codex.conversationEnv?.('/tmp/run', true) ?? {};
    expect((JSON.parse(env.CODEX_CONFIG ?? '{}') as CodexShape).features.apps).toBe(false);
  });

  it('are off in every Claude and Z.ai session: chat, project, changing and probe', () => {
    for (const definition of [agentDefinitions.claude, agentDefinitions.zai]) {
      const metas = [
        definition.conversationSessionMeta?.(),
        definition.projectSessionMeta?.([]),
        definition.projectSessionMeta?.([], null, true, true),
        definition.doSessionMeta?.([]),
        definition.doSessionMeta?.(['/work/lib'], null, true),
        definition.probeSessionMeta,
      ];
      for (const meta of metas) {
        const options = claudeOptions(meta);
        expect(options.strictMcpConfig).toBe(true);
        expect(options.settings.disableClaudeAiConnectors).toBe(true);
      }
    }
  });
});

const APPS_CALL: acp.ToolCallUpdate = {
  toolCallId: 'apps-1',
  title: 'mcp.codex_apps.github.search_installed_repositories_v2',
  kind: 'execute',
  rawInput: { server: 'codex_apps', tool: 'github.search_installed_repositories_v2' },
  _meta: { is_mcp_tool_call: true },
};

describe('an MCP tool call Codex makes without asking', () => {
  const context = { rpcId: null, roots: [], cwd: '/work/app', home: '/Users/me' };

  it('is read as a call to that MCP server, so it counts as a send off this computer', () => {
    const request = approvalRequestFrom(
      { sessionId: 's', toolCall: APPS_CALL, options: [] },
      context,
    );
    expect(request.mcpServer).toBe('codex_apps');
  });

  it('is not read that way for a shell command that merely looks like one', () => {
    const shell: acp.ToolCallUpdate = {
      toolCallId: 'shell-1',
      title: 'mcp.codex_apps.github',
      kind: 'execute',
      rawInput: { command: 'mcp.codex_apps.github', server: 'codex_apps' },
    };
    const request = approvalRequestFrom({ sessionId: 's', toolCall: shell, options: [] }, context);
    expect(request.mcpServer).toBeUndefined();
  });

  it('is marked as ran without review once it completes', () => {
    const review = createReviewTracker();
    expect(review.settle({ sessionUpdate: 'tool_call', status: 'in_progress', ...APPS_CALL })).toBe(
      null,
    );
    const done = { sessionUpdate: 'tool_call_update', toolCallId: 'apps-1', status: 'completed' };
    expect(review.settle(done)).toEqual({ toolCallId: 'apps-1', kind: 'execute' });
  });

  it('is recorded in the audit, and the entry that completes it is marked', async () => {
    const written: ProtocolEntry[] = [];
    const audit = createAuditRecorder({
      write: async (entries) => {
        written.push(...entries);
      },
      flushMs: 10_000,
    });
    const update = (fields: Record<string, unknown>) => ({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { update: fields },
    });
    audit.message(
      'from_agent',
      update({ sessionUpdate: 'tool_call', status: 'in_progress', ...APPS_CALL }),
    );
    audit.message(
      'from_agent',
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'apps-1', status: 'completed' }),
    );
    await audit.close();
    expect(written.map((entry) => entry.unreviewed === true)).toEqual([false, true]);
    expect(JSON.stringify(written[0]!.payload)).toContain(APPS_CALL.title);
  });
});
