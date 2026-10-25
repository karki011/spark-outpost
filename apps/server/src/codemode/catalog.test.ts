import { expect, it } from 'vitest';
import { z } from 'zod';
import type { SparkToolDeps } from '../spark-mcp/deps.ts';
import { callSparkTool } from '../spark-mcp/server.ts';
import { workTools } from '../spark-mcp/tools/work-tools.ts';
import { githubTools } from '../spark-mcp/tools/github-tools.ts';
import { docsTool } from '../spark-mcp/tools/docs-tool.ts';
import { guideTool } from '../spark-mcp/tools/guide-tool.ts';
import type { SparkToolContext } from '../spark-mcp/tool.ts';
import { describeCodeModeTools } from './catalog.ts';
import { codeModeResult } from './results.ts';

const context: SparkToolContext = {
  deps: {} as SparkToolDeps,
  scope: { workspaceId: 'workspace', conversationId: null, runId: null },
};

it('describes guide result access that works with the real dispatcher', async () => {
  const [description] = describeCodeModeTools([guideTool], 'spark_guide');
  expect(description?.resultHint).toContain('data.matches.map(match => match.text)');
  const result = codeModeResult(
    await callSparkTool(guideTool, { section: 'spark-tools' }, context),
  );
  const { data } = z
    .object({
      isError: z.literal(false),
      data: z.object({
        matches: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })),
      }),
    })
    .parse(result);
  expect(data.matches.map((match) => match.text).join('\n')).toContain('spark_docs');
  expect(data.matches[0]?.id).toBe('spark-tools');
});

it('keeps listing and empty-search guide shapes distinct from successful matches', async () => {
  const listing = codeModeResult(await callSparkTool(guideTool, {}, context));
  expect(listing).toMatchObject({
    data: { sections: expect.arrayContaining([{ id: 'spark-tools', title: expect.any(String) }]) },
  });
  expect(listing).not.toHaveProperty('data.matches');
  const empty = codeModeResult(
    await callSparkTool(guideTool, { query: 'qzxnonexistentguidephrase' }, context),
  );
  expect(empty).toMatchObject({
    data: { matches: [], sections: expect.any(Array), note: expect.any(String) },
  });
});

it('advertises real input schemas for all five tools with defaulted fields omittable', () => {
  const descriptions = describeCodeModeTools([...workTools, ...githubTools, docsTool, guideTool]);
  expect(descriptions.map((tool) => tool.name).sort()).toEqual([
    'spark_docs',
    'spark_guide',
    'spark_pr',
    'spark_pull_requests',
    'spark_tickets',
  ]);
  for (const tool of descriptions) {
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.resultHint).toBeTruthy();
    const required = tool.inputSchema.required ?? [];
    for (const field of ['limit', 'offset', 'action', 'state'])
      expect(required).not.toContain(field);
    if (tool.name === 'spark_pr') expect(required).toContain('number');
    else expect(required).toEqual([]);
  }
});
