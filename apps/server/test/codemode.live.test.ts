import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { startSparkMcpHost } from '../src/spark-mcp/host.ts';
import {
  connectCliProvider,
  createTestDb,
  dropSpareSchemas,
  ensureWorkerDatabase,
  startChat,
} from './support.ts';
import { recordedHooks, toolDeps } from './spark-mcp-support.ts';

beforeAll(async () => {
  vi.stubEnv('SPARK_CODE_MODE', '1');
  await ensureWorkerDatabase();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await dropSpareSchemas();
});

function hasCombinedResult(output: unknown): boolean {
  if (typeof output === 'string') {
    try {
      return hasCombinedResult(JSON.parse(output));
    } catch {
      return false;
    }
  }
  if (!output || typeof output !== 'object') return false;
  if ('value' in output && JSON.stringify(output.value) === '["overview","providers"]') return true;
  return Object.values(output).some(hasCombinedResult);
}

describe.each(['claude', 'codex'] as const)('live %s Code Mode', (id) => {
  it('discovers the tool and combines two guide reads in the local runtime', async () => {
    const t = await createTestDb();
    const recorded = recordedHooks();
    const host = await startSparkMcpHost(toolDeps(t));
    try {
      await connectCliProvider(t, id);
      const { conversationId, runId } = await startChat(t, 'Verify Code Mode guide composition');
      const provider = createAcpProvider({ definition: agentDefinitions[id], sparkTools: host });
      let text = '';
      const steps: string[] = [];
      const results: unknown[] = [];
      for await (const output of provider.run({
        prompt:
          'Verify the experimental spark_execute tool. First discover its spark_guide input schema using query. Then use ONE spark_execute code call to read guide sections overview and providers concurrently through tools.call, check both isError fields, and return only their section IDs sorted alphabetically. Use an explicit return. Do not use shell, files, web, or other tools. Reply CODEMODE_OK overview, providers only if execution returned both IDs; otherwise report the failure.',
        history: [],
        settings: { method: 'cli', model: null, modelLabel: null, effort: 'low' },
        signal: recorded.hooks.signal,
        sparkScope: {
          workspaceId: t.workspaceId,
          conversationId,
          runId,
          codeMode: true,
          actions: recorded.hooks,
        },
      })) {
        if (output.kind === 'text_delta') text += output.delta;
        if (output.kind === 'step_started') steps.push(output.name);
        if (output.kind === 'tool_result') results.push(output.output);
      }
      const completed = recorded.audited.filter((entry) => {
        const event = entry as { method?: string; params?: { name?: string; outcome?: string } };
        return (
          event.method === 'spark/code_mode_call' &&
          event.params?.name === 'spark_guide' &&
          event.params.outcome === 'completed'
        );
      });
      console.log(`${id} Code Mode acceptance`, { steps, completedReads: completed.length, text });
      expect(completed).toHaveLength(2);
      expect(results.some(hasCombinedResult)).toBe(true);
      expect(text).toContain('CODEMODE_OK');
      expect(text).toContain('overview');
      expect(text).toContain('providers');
    } finally {
      recorded.stop();
      await host.close();
      await t.cleanup();
    }
  });
});
