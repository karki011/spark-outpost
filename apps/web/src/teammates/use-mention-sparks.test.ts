import { describe, expect, it } from 'vitest';
import { sparksMatching } from './use-mention-sparks.ts';

const sparks = ['Pip', 'Wren', 'Release Pilot', 'Ada', 'Bolt', 'Nova', 'Juno', 'Vega'].map(
  (name) => ({ name }),
);
const names = (query: string) => sparksMatching(sparks, query).map((spark) => spark.name);

describe('sparksMatching', () => {
  it('lists the first six Sparks for a bare @', () => {
    expect(names('')).toEqual(['Pip', 'Wren', 'Release Pilot', 'Ada', 'Bolt', 'Nova']);
  });

  it('keeps Sparks with a word that starts with the query, ignoring case', () => {
    expect(names('pi')).toEqual(['Pip', 'Release Pilot']);
    expect(names('REL')).toEqual(['Release Pilot']);
    expect(names('ip')).toEqual([]);
  });
});
