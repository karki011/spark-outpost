import { describe, expect, it } from 'vitest';
import { CHAT_TURN_ONLY, SPARK_TOOLS } from '../../spark-mcp/server.ts';

describe('who can clone a repository', () => {
  it('offers agents one Spark tool that clones a repository, and only in a chat turn', () => {
    const mentions = SPARK_TOOLS.filter((tool) => {
      const text = JSON.stringify(tool);
      return /clon(e|ing)/i.test(text) && /\brepo(sitor(y|ies))?\b/i.test(text);
    });
    expect(mentions.map((tool) => tool.name)).toEqual(['spark_clone_repo']);
    expect(mentions[0]!.acts).toBe(true);
    expect(CHAT_TURN_ONLY.has('spark_clone_repo')).toBe(true);
  });
});
