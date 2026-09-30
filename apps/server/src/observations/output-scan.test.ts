import { describe, expect, it } from 'vitest';
import type { Observation } from '../persistence/observations.ts';
import type { ProtocolObserver } from '../providers/provider.ts';
import { scannedObserver } from './output-scan.ts';

const TOKEN = `ghp_${'a1B2'.repeat(9)}`;

function toolUpdate(sessionUpdate: string, fields: Record<string, unknown>) {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 's', update: { sessionUpdate, toolCallId: 'call-1', ...fields } },
  };
}

const text = (value: string) => [{ type: 'content', content: { type: 'text', text: value } }];

function scanner(values: readonly string[] = []) {
  const recorded: Observation[] = [];
  const audited: unknown[] = [];
  const audit: ProtocolObserver = {
    message: (_direction, message) => audited.push(message),
    stderr: () => undefined,
  };
  const observer = scannedObserver(audit, values, (observation) => recorded.push(observation));
  return { observer, recorded, audited };
}

describe('scannedObserver', () => {
  it('records secret values in a tool call output, once per call, and still audits', () => {
    const { observer, recorded, audited } = scanner();
    observer.message('from_agent', toolUpdate('tool_call', { title: 'env', kind: 'execute' }));
    observer.message(
      'from_agent',
      toolUpdate('tool_call_update', { content: text(`HOME=/Users/me\nGITHUB_TOKEN=${TOKEN}\n`) }),
    );
    observer.message(
      'from_agent',
      toolUpdate('tool_call_update', { rawOutput: { stdout: `again ${TOKEN}` } }),
    );
    expect(recorded).toEqual([
      { source: 'secret_output', label: 'secret values in the output of `env`' },
    ]);
    expect(audited).toHaveLength(3);
  });

  it("finds the project's own secret values in raw output", () => {
    const { observer, recorded } = scanner(['s3cr3t-db-pass']);
    observer.message(
      'from_agent',
      toolUpdate('tool_call', {
        title: 'docker compose config',
        rawOutput: 'password: s3cr3t-db-pass',
      }),
    );
    expect(recorded.map((observation) => observation.label)).toEqual([
      'secret values in the output of `docker compose config`',
    ]);
  });

  it('records a file read through the client that holds secret values', () => {
    const { observer, recorded } = scanner();
    observer.message('from_agent', {
      jsonrpc: '2.0',
      id: 4,
      method: 'fs/read_text_file',
      params: { sessionId: 's', path: '/work/app/config/prod.yaml' },
    });
    observer.message('to_agent', {
      jsonrpc: '2.0',
      id: 4,
      result: { content: `api:\n  key: sk-${'x9'.repeat(12)}\n` },
    });
    expect(recorded).toEqual([{ source: 'secret_output', label: 'secret values in prod.yaml' }]);
  });

  it('ignores placeholders, plain code, diffs and messages to the agent', () => {
    const { observer, recorded } = scanner();
    observer.message(
      'from_agent',
      toolUpdate('tool_call', {
        title: 'cat .env.example',
        content: text(
          'API_KEY=your-api-key-here\nSECRET_TOKEN=\nDB_PASSWORD=changeme\nPORT=3000\n',
        ),
      }),
    );
    observer.message(
      'from_agent',
      toolUpdate('tool_call_update', {
        content: [{ type: 'diff', path: '/work/app/a.ts', oldText: null, newText: TOKEN }],
      }),
    );
    observer.message(
      'from_agent',
      toolUpdate('tool_call_update', {
        content: text('const token = process.env.GITHUB_TOKEN;\n"token": "[redacted:token]"'),
      }),
    );
    observer.message('to_agent', toolUpdate('tool_call_update', { content: text(TOKEN) }));
    expect(recorded).toEqual([]);
  });
});
