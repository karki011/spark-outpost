import { describe, expect, it } from 'vitest';
import { SPARK_TOOLS } from '../../spark-mcp/server.ts';

describe('who can clone a repository', () => {
  it('offers agents no Spark tool that clones', () => {
    const mentions = SPARK_TOOLS.filter((tool) => /clon(e|ing)/i.test(JSON.stringify(tool)));
    expect(mentions.map((tool) => tool.name)).toEqual([]);
  });
});
