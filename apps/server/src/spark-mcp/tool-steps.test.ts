import { describe, expect, it } from 'vitest';
import { SPARK_TOOL_STEPS, friendlyStep } from '@spark-outpost/contracts';
import { SPARK_MCP_NAME, SPARK_TOOLS } from './server.ts';

describe('Spark tool steps', () => {
  it('gives every registered Spark tool a plain-words step', () => {
    const missing = SPARK_TOOLS.map((tool) => tool.name).filter((name) => !SPARK_TOOL_STEPS[name]);
    expect(missing).toEqual([]);
  });

  it('never shows a raw Spark tool name', () => {
    for (const tool of SPARK_TOOLS) {
      const step = friendlyStep(`mcp__${SPARK_MCP_NAME}__${tool.name}`);
      expect(step).not.toContain('spark_');
      expect(step).not.toContain('mcp');
    }
  });
});
