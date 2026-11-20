import type * as acp from '@agentclientprotocol/sdk/unstable';
import {
  clientSystemPrompt,
  sessionSystemPrompt,
} from '@agentclientprotocol/claude-agent-acp/dist/client-system-prompt.js';
import { describe, expect, it } from 'vitest';
import { claudeSessionMeta } from './agents.ts';
import { newSessionRequest } from './session-request.ts';

const SPARK_TEXT = 'You are working in Spark Outpost.';

function init(sessionCapabilities: Record<string, unknown> = {}): acp.InitializeResponse {
  return { protocolVersion: 1, agentCapabilities: { sessionCapabilities } };
}

function claudeMeta(appendPrompt: string | null): Record<string, unknown> {
  return claudeSessionMeta([], [], {
    appendPrompt,
    plugins: [],
    hooks: null,
    skillTool: false,
    agentTool: false,
  });
}

function request(meta: Record<string, unknown> | null, agent: acp.InitializeResponse) {
  return newSessionRequest({ agentName: 'Claude', cwd: '/repo', extraRoots: [], meta, init: agent })
    .request;
}

describe('the system prompt on session requests', () => {
  it('sends the stable append field when the agent advertises it, and not the old shape', () => {
    const sent = request(
      claudeMeta(SPARK_TEXT),
      init({ systemPrompt: { mode: { override: {} } } }),
    );
    expect(sent.systemPrompt).toEqual({
      mode: 'append',
      content: [{ type: 'text', text: SPARK_TEXT }],
    });
    expect(sent._meta).not.toHaveProperty('systemPrompt');
    expect(sent._meta).toHaveProperty('claudeCode');
  });

  it('keeps the old _meta shape when the agent does not advertise systemPrompt', () => {
    const sent = request(claudeMeta(SPARK_TEXT), init());
    expect(sent.systemPrompt).toBeUndefined();
    expect(sent._meta).toMatchObject({ systemPrompt: { append: SPARK_TEXT } });
  });

  it('never sends an empty prompt', () => {
    const blank = { ...claudeMeta(null), systemPrompt: { append: '  ' } };
    const sent = request(blank, init({ systemPrompt: {} }));
    expect(sent.systemPrompt).toBeUndefined();
    expect(sent._meta).not.toHaveProperty('systemPrompt');
  });

  it('sends nothing new for an agent whose meta carries no Spark prompt, such as Codex', () => {
    const sent = request(null, init({ systemPrompt: {} }));
    expect(sent.systemPrompt).toBeUndefined();
    expect(sent._meta).toBeNull();
  });

  it('gives the pinned Claude adapter the same SDK prompt as the old shape', () => {
    const stable = request(claudeMeta(SPARK_TEXT), init({ systemPrompt: {} }));
    const legacy = request(claudeMeta(SPARK_TEXT), init());
    const fromStable = sessionSystemPrompt(
      clientSystemPrompt(stable.systemPrompt),
      (stable._meta as Record<string, unknown>).systemPrompt,
      undefined,
    );
    const fromLegacy = sessionSystemPrompt(
      undefined,
      (legacy._meta as Record<string, unknown>).systemPrompt,
      undefined,
    );
    expect(fromStable).toEqual({ type: 'preset', preset: 'claude_code', append: SPARK_TEXT });
    expect(fromStable).toEqual(fromLegacy);
  });
});

describe('MCP servers over stdin', () => {
  it('asks the Claude adapter to send MCP servers in the initialize request', () => {
    const sent = newSessionRequest({
      agentName: 'Claude',
      cwd: '/repo',
      extraRoots: [],
      meta: claudeMeta(null),
      init: init(),
      mcpOverStdin: true,
    }).request;
    expect(sent._meta).toMatchObject({
      claudeCode: { options: { mcpServersDelivery: 'initialize' } },
    });
  });

  it('leaves the delivery to the adapter for an older Claude Code or another agent', () => {
    const older = request(claudeMeta(null), init());
    expect(older._meta).not.toMatchObject({
      claudeCode: { options: { mcpServersDelivery: expect.anything() } },
    });
    const codex = newSessionRequest({
      agentName: 'Codex',
      cwd: '/repo',
      extraRoots: [],
      meta: null,
      init: init(),
      mcpOverStdin: true,
    }).request;
    expect(codex._meta).toBeNull();
  });
});
