import { describe, expect, it } from 'vitest';
import { chatResearchBase, researchCopyFolder } from './research-copies.ts';

describe('where research copies live', () => {
  it('gives each Spark data folder its own base, so one instance never sweeps another', () => {
    const first = chatResearchBase('/Users/me/Library/Application Support/Spark', 'spark', '/tmp');
    const second = chatResearchBase('/private/tmp/other-data', 'spark', '/tmp');
    expect(first).not.toBe(second);
    expect(first).toBe(
      chatResearchBase('/Users/me/Library/Application Support/Spark', 'spark', '/tmp'),
    );
    expect(first.startsWith('/tmp/spark-outpost-research/')).toBe(true);
  });

  it('keeps each chat and repo in its own folder', () => {
    const chat = '0190f0a0-0000-7000-8000-000000000001';
    expect(researchCopyFolder('/base', chat, 'acme/widgets')).toBe(`/base/${chat}/acme/widgets`);
    expect(() => researchCopyFolder('/base', '../x', 'acme/widgets')).toThrow();
    for (const slug of ['acme/..', 'acme/.', '../widgets']) {
      expect(() => researchCopyFolder('/base', chat, slug)).toThrow();
    }
  });
});
