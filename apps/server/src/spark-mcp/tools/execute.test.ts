import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EVERYTHING_AVAILABLE } from '../availability.ts';
import type { SparkActionHooks, SparkScope, SparkToolDeps } from '../deps.ts';
import { callSparkTool, sparkToolsFor } from '../server.ts';
import { sparkTool, type SparkToolContext } from '../tool.ts';
import { executeTool } from './execute.ts';

vi.mock('../../persistence/code-mode-settings.ts', () => ({
  codeModeEnabled: vi.fn(async () => true),
}));

beforeEach(() => vi.stubEnv('SPARK_CODE_MODE', '1'));
afterEach(() => vi.unstubAllEnvs());

function scope(): SparkScope {
  return {
    workspaceId: 'workspace',
    conversationId: 'chat',
    runId: 'run',
    codeMode: true,
    actions: { signal: new AbortController().signal } as SparkActionHooks,
  };
}

it('offers Code Mode by default for eligible live chat runs and respects opt-out', () => {
  const offered = (context: Partial<SparkScope>) =>
    sparkToolsFor(context, EVERYTHING_AVAILABLE).some((tool) => tool.name === 'spark_execute');
  vi.stubEnv('SPARK_CODE_MODE', undefined);
  expect(offered(scope())).toBe(true);
  expect(offered({ ...scope(), readOnly: true })).toBe(true);
  expect(offered({ ...scope(), codeMode: false })).toBe(false);
  expect(offered({ ...scope(), runId: null })).toBe(false);
  expect(offered({ ...scope(), rebinds: true })).toBe(false);
  expect(offered({ readOnly: true })).toBe(false);
  vi.stubEnv('SPARK_CODE_MODE', '0');
  expect(offered(scope())).toBe(false);
});

it('discovers schemas and batches actual tool dispatch with partial failure receipts', async () => {
  const run = vi.fn(async ({ number }: { number: number }) => ({ number, checks: 'passing' }));
  const inner = sparkTool({
    name: 'spark_pr',
    title: 'Pull request',
    description: 'Read a PR',
    input: { number: z.number().int().positive() },
    run,
  });
  const tool = executeTool({
    toolsFor: () => [inner],
    callTool: callSparkTool,
    availabilityOf: async () => EVERYTHING_AVAILABLE,
  });
  const context: SparkToolContext = { scope: scope(), deps: {} as SparkToolDeps, callId: 'outer' };
  expect(await tool.run({ query: 'spark_pr' }, context)).toMatchObject({
    tools: [{ name: 'spark_pr', inputSchema: { required: ['number'] } }],
  });
  expect(
    await tool.run(
      {
        code: 'const a = await tools.call("spark_pr", {number: 1}); const b = await tools.call("spark_pr", {number: 2}); return [a.data.number, b.data.number];',
      },
      context,
    ),
  ).toMatchObject({
    value: [1, 2],
    toolCalls: [
      { name: 'spark_pr', callId: 'outer:1', outcome: 'completed' },
      { name: 'spark_pr', callId: 'outer:2', outcome: 'completed' },
    ],
  });
  expect(
    await tool.run(
      {
        code: 'await tools.call("spark_pr", {number: 3}); throw new Error("failed after first read");',
      },
      context,
    ),
  ).toMatchObject({
    error: expect.stringContaining('failed after first read'),
    toolCalls: [{ name: 'spark_pr', outcome: 'completed' }],
  });
  expect(run).toHaveBeenCalledTimes(3);
});

it('refuses stale scopes even if a caller holds a prior execute tool reference', async () => {
  const tool = executeTool({ toolsFor: () => [], callTool: callSparkTool });
  await expect(
    tool.run(
      { code: 'return 1;' },
      { scope: { ...scope(), runId: null }, deps: {} as SparkToolDeps },
    ),
  ).rejects.toThrow('unavailable');
});

it('reports execution failures to MCP while retaining successful read receipts', async () => {
  const inner = sparkTool({
    name: 'spark_pr',
    title: 'Pull request',
    description: 'Read a PR',
    input: {},
    run: async () => ({ checks: 'passing' }),
  });
  const tool = executeTool({
    toolsFor: () => [inner],
    callTool: callSparkTool,
    availabilityOf: async () => EVERYTHING_AVAILABLE,
  });
  const context: SparkToolContext = { scope: scope(), deps: {} as SparkToolDeps };
  const failed = await callSparkTool(
    tool,
    {
      code: 'await tools.call("spark_pr", {}); throw new Error("execution failed");',
    },
    context,
  );
  expect(failed.isError).toBe(true);
  expect(failed.content[0]?.type).toBe('text');
  const text = failed.content[0];
  expect(text?.type === 'text' && JSON.parse(text.text)).toMatchObject({
    error: expect.stringContaining('execution failed'),
    toolCalls: [{ name: 'spark_pr', outcome: 'completed' }],
    totalCalls: 1,
  });
  const succeeded = await callSparkTool(
    tool,
    { code: 'return {error: "application data"};' },
    context,
  );
  expect(succeeded.isError).not.toBe(true);
  expect(succeeded.content).toEqual([
    { type: 'text', text: expect.stringContaining('application data') },
  ]);
  const discovered = await callSparkTool(tool, {}, context);
  expect(discovered.isError).not.toBe(true);
  expect(discovered.content).toEqual([{ type: 'text', text: expect.stringContaining('spark_pr') }]);
});

it('does not reinterpret error fields returned by other Spark tools', async () => {
  const tool = sparkTool({
    name: 'spark_pr',
    title: 'Pull request',
    description: 'Read a PR',
    input: {},
    run: async () => ({ error: 'A check failed' }),
  });
  const result = await callSparkTool(tool, {}, { scope: scope(), deps: {} as SparkToolDeps });
  expect(result.isError).not.toBe(true);
  expect(result.content).toEqual([{ type: 'text', text: '{"error":"A check failed"}' }]);
});
