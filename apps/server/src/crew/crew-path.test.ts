import { describe, expect, it } from 'vitest';
import { crewPath, untrustedReads } from './crew-path.ts';

describe('crewPath', () => {
  const clean = { modePath: 'perform' as const, userWrote: true, untrusted: [] };

  it('follows the mode for a turn the user wrote with nothing untrusted read', () => {
    expect(crewPath(clean)).toBe('perform');
    expect(crewPath({ ...clean, modePath: 'confirm' })).toBe('confirm');
  });

  it('asks after an untrusted read, for text the user did not write, or when reads are unknown', () => {
    expect(crewPath({ ...clean, untrusted: ['web page (example.com)'] })).toBe('confirm');
    expect(crewPath({ ...clean, userWrote: false })).toBe('confirm');
    expect(crewPath({ ...clean, untrusted: null })).toBe('confirm');
  });

  it('does not count reading the crew or the docs', () => {
    expect(
      untrustedReads([
        'private work data (spark_sparks)',
        'private work data (spark_crew)',
        'private work data (spark_docs)',
        'private work data (spark_jira)',
      ]),
    ).toEqual(['private work data (spark_jira)']);
  });
});
