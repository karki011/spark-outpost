import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { decide, NO_RUN_RULES, type ApprovalRequest } from '../src/approvals/decide.ts';
import type { GateAnswer, ProviderOutput } from '../src/providers/provider.ts';

const repo = realpathSync(mkdtempSync(join(tmpdir(), 'spark-live-web-')));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function answer(request: ApprovalRequest): GateAnswer {
  const decision = decide('full_access', request, NO_RUN_RULES, []);
  const kind = decision.verdict === 'allow' ? 'allow_once' : 'reject_once';
  const option = request.options.find((candidate) => candidate.kind === kind)!;
  const denial = decision.verdict === 'reject' ? decision.reason : undefined;
  return {
    outcome: 'selected',
    optionId: option.optionId,
    allowed: decision.verdict === 'allow',
    note: decision.verdict,
    ...(denial ? { denial } : {}),
  };
}

describe('live Claude web tools in a Do turn', () => {
  it('searches the web, records the read, and never fetches this computer', async () => {
    const asked: ApprovalRequest[] = [];
    const provider = createAcpProvider({ definition: agentDefinitions.claude });
    const outputs: ProviderOutput[] = [];
    for await (const output of provider.run({
      prompt:
        'Do these three steps, one tool call each, and do not retry or work around a refusal: 1) Use your WebSearch tool to search for "Agent Client Protocol Zed". 2) Use your WebFetch tool on http://127.0.0.1:9/status. 3) Use your WebFetch tool on http://127.0.0.2:9/status. Then reply with one short line per step.',
      history: [],
      settings: { method: 'cli', model: 'haiku', modelLabel: null, effort: 'low', mode: 'default' },
      signal: new AbortController().signal,
      projectRoots: [repo],
      mode: 'do',
      approvals: {
        review: async (request) => {
          asked.push(request);
          return answer(request);
        },
      },
    })) {
      outputs.push(output);
    }
    const steps = outputs.flatMap((output) =>
      output.kind === 'step_started' ? [output.name] : [],
    );
    const reads = outputs.flatMap((output) => (output.kind === 'web_read' ? output.labels : []));
    const text = outputs
      .map((output) => (output.kind === 'text_delta' ? output.delta : ''))
      .join('');
    console.log('live web tools', {
      steps,
      reads,
      asked: asked.map((request) => [request.title, request.address ?? null]),
      text: text.slice(0, 400),
    });
    expect(steps).toContain('Searched the web');
    expect(reads).toContain('web search');
    expect(reads.some((label) => label.includes('127.0.0'))).toBe(false);
    const loopback = asked.find((request) => request.address === 'http://127.0.0.2:9/status');
    expect(loopback && answer(loopback)).toMatchObject({ allowed: false });
  });
});
