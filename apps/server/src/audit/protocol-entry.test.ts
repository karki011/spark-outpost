import { describe, expect, it } from 'vitest';
import { pastedSecretKinds } from '@spark-outpost/contracts';
import { PAYLOAD_CAP_BYTES, capPayload, createProtocolRecorder } from './protocol-entry.ts';

const at = new Date('2026-09-26T10:00:00.000Z');

describe('protocol entries', () => {
  it('classifies messages and names replies after their request', () => {
    const recorder = createProtocolRecorder();
    const request = { jsonrpc: '2.0', id: 7, method: 'session/prompt', params: {} };
    const note = { jsonrpc: '2.0', method: 'session/update', params: {} };
    const reply = { jsonrpc: '2.0', id: 7, result: { stopReason: 'end_turn' } };
    const failure = { jsonrpc: '2.0', id: 8, error: { code: -32601, message: 'nope' } };
    const entries = [
      recorder.entry('to_agent', request, at),
      recorder.entry('from_agent', note, at),
      recorder.entry('from_agent', reply, at),
      recorder.entry('from_agent', failure, at),
    ];
    expect(entries.map(({ kind, method, rpcId }) => ({ kind, method, rpcId }))).toEqual([
      { kind: 'request', method: 'session/prompt', rpcId: '7' },
      { kind: 'notification', method: 'session/update', rpcId: null },
      { kind: 'response', method: 'session/prompt', rpcId: '7' },
      { kind: 'error', method: null, rpcId: '8' },
    ]);
    expect(entries[0]!.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(request)));
  });

  it('redacts a secret pasted into a chat message before it reaches the audit log', () => {
    const recorder = createProtocolRecorder();
    const text =
      'Use sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv1234\nGITHUB_TOKEN=a8f9c2d1e7b6a5f4c3d2e1f0';
    const entry = recorder.entry(
      'to_agent',
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'session/prompt',
        params: { prompt: [{ type: 'text', text }] },
      },
      at,
    );
    const stored = JSON.stringify(entry.payload);
    expect(pastedSecretKinds(text)).toEqual(['api_key', 'env']);
    expect(stored).toContain('Use [redacted:api_key]\\nGITHUB_TOKEN=[redacted:env]');
    expect(pastedSecretKinds(stored)).toEqual([]);
  });

  it('does not confuse request ids from the two directions', () => {
    const recorder = createProtocolRecorder();
    recorder.entry('to_agent', { jsonrpc: '2.0', id: 1, method: 'initialize' }, at);
    recorder.entry('from_agent', { jsonrpc: '2.0', id: 1, method: 'fs/read_text_file' }, at);
    const ours = recorder.entry('to_agent', { jsonrpc: '2.0', id: 1, result: {} }, at);
    const theirs = recorder.entry('from_agent', { jsonrpc: '2.0', id: 1, result: {} }, at);
    expect(ours.method).toBe('fs/read_text_file');
    expect(theirs.method).toBe('initialize');
  });

  it('hides the content of a secret file returned to the agent', () => {
    const recorder = createProtocolRecorder();
    recorder.entry(
      'from_agent',
      { jsonrpc: '2.0', id: 3, method: 'fs/read_text_file', params: { path: '/app/.env' } },
      at,
    );
    const reply = recorder.entry(
      'to_agent',
      { jsonrpc: '2.0', id: 3, result: { content: 'PLAIN=value' } },
      at,
    );
    expect(reply.payload).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { content: '[redacted:secret_file]' },
    });
  });

  it('hides later output of a tool call that touched a secret file', () => {
    const recorder = createProtocolRecorder();
    const update = (value: Record<string, unknown>) =>
      recorder.entry(
        'from_agent',
        { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: value } },
        at,
      );
    update({
      sessionUpdate: 'tool_call',
      toolCallId: 'a',
      title: 'Read file',
      locations: [{ path: '/app/config/credentials.json' }],
    });
    const later = update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'a',
      rawOutput: 'user=admin',
      content: [{ type: 'content', content: { type: 'text', text: 'user=admin' } }],
    });
    const other = update({ sessionUpdate: 'tool_call_update', toolCallId: 'b', rawOutput: 'ok' });
    expect(JSON.stringify(later.payload)).not.toContain('user=admin');
    expect(later.payload).toMatchObject({
      params: {
        update: { rawOutput: '[redacted:secret_file]', content: '[redacted:secret_file]' },
      },
    });
    expect(other.payload).toMatchObject({ params: { update: { rawOutput: 'ok' } } });
  });

  it('caps large payloads and keeps the original size', () => {
    const recorder = createProtocolRecorder();
    const big = { jsonrpc: '2.0', method: 'session/update', params: { text: 'é'.repeat(70_000) } };
    const entry = recorder.entry('from_agent', big, at);
    expect(entry.truncated).toBe(true);
    expect(entry.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(big)));
    const head = (entry.payload as { head: string }).head;
    expect(Buffer.byteLength(head)).toBeLessThanOrEqual(PAYLOAD_CAP_BYTES);
    expect(head.startsWith('{"jsonrpc":"2.0"')).toBe(true);
  });

  it('keeps payloads at the cap untouched', () => {
    const payload = { text: 'x'.repeat(PAYLOAD_CAP_BYTES - 11) };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBe(PAYLOAD_CAP_BYTES);
    expect(capPayload(payload)).toEqual({ payload, truncated: false });
  });

  it('hides MCP env and header values sent when a session opens', () => {
    const recorder = createProtocolRecorder();
    const request = {
      jsonrpc: '2.0',
      id: 3,
      method: 'session/new',
      params: {
        cwd: '/work',
        mcpServers: [
          { name: 'gh', command: 'gh-mcp', args: [], env: [{ name: 'PLAIN', value: 'abc123' }] },
          { type: 'http', name: 'docs', url: 'https://d', headers: [{ name: 'X', value: 'k9' }] },
        ],
      },
    };
    const entry = recorder.entry('to_agent', request, at);
    const text = JSON.stringify(entry.payload);
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('k9');
    expect(text).toContain('"name":"PLAIN"');
    expect(text).toContain('gh-mcp');
  });

  it('hides the header and env values of servers sent in Claude options when a session opens', () => {
    const recorder = createProtocolRecorder();
    const spark = { type: 'http', url: 'http://127.0.0.1:1/mcp', timeout: 3_600_000 };
    const mcpServers = {
      spark: { ...spark, headers: { Authorization: 'Bearer tok-123' } },
      gh: { type: 'stdio', command: 'gh-mcp', env: { PLAIN: 'abc123' } },
    };
    const request = {
      jsonrpc: '2.0',
      id: 3,
      method: 'session/resume',
      params: {
        cwd: '/work',
        sessionId: 's1',
        mcpServers: [],
        _meta: { claudeCode: { options: { tools: ['Read'], mcpServers } } },
      },
    };
    const entry = recorder.entry('to_agent', request, at);
    const text = JSON.stringify(entry.payload);
    expect(text).not.toContain('tok-123');
    expect(text).not.toContain('abc123');
    expect(text).toContain('"Authorization"');
    expect(text).toContain('"PLAIN"');
    expect(text).toContain('"timeout":3600000');
    expect(text).toContain('"tools":["Read"]');
  });

  it('redacts the kept head of a huge edit quickly and never stores the rest', () => {
    const recorder = createProtocolRecorder();
    const filler = 'const value = compute(input);\n'.repeat(70_000);
    const update = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'edit',
      rawInput: {
        file_path: 'src/big.ts',
        old_string: `GITHUB_TOKEN=a8f9c2d1e7b6a5f4c3d2e1f0\n${filler}`,
        new_string: `${filler}sk-tail-AbCdEfGhIjKlMnOp1234`,
      },
    };
    const message = { jsonrpc: '2.0', method: 'session/update', params: { update } };
    const started = performance.now();
    const entry = recorder.entry('from_agent', message, at);
    const elapsed = performance.now() - started;
    const head = (entry.payload as { head: string }).head;
    expect(entry.sizeBytes).toBeGreaterThan(4_000_000);
    expect(entry.truncated).toBe(true);
    expect(Buffer.byteLength(head)).toBeLessThanOrEqual(PAYLOAD_CAP_BYTES);
    expect(head.startsWith('{"jsonrpc":"2.0"')).toBe(true);
    expect(head).toContain('"old_string":"GITHUB_TOKEN=[redacted:env]');
    expect(head).not.toContain('a8f9c2d1e7b6a5f4c3d2e1f0');
    expect(head).not.toContain('sk-tail');
    expect(elapsed).toBeLessThan(200);
  });
});
