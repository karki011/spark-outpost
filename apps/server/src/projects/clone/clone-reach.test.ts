import { describe, expect, it } from 'vitest';
import { CHAT_TURN_ONLY, SPARK_TOOLS } from '../../spark-mcp/server.ts';

describe('who can clone a repository', () => {
  it('offers agents one Spark tool that clones, and only in a chat turn', () => {
    const mentions = SPARK_TOOLS.filter((tool) => /clon(e|ing)/i.test(JSON.stringify(tool)));
    expect(mentions.map((tool) => tool.name)).toEqual(['spark_clone_repo']);
    expect(mentions[0]!.acts).toBe(true);
    expect(CHAT_TURN_ONLY.has('spark_clone_repo')).toBe(true);
  });
});
