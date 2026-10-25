import { expect, it } from 'vitest';
import { z } from 'zod';
import type { SparkToolDeps } from '../spark-mcp/deps.ts';
import { callSparkTool } from '../spark-mcp/server.ts';
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
