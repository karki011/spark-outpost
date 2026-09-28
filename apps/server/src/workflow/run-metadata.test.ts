import { describe, expect, it } from 'vitest';
import { mergeEfforts } from './run-metadata.ts';

const option = (id: string, label = id) => ({ id, label, description: null });

describe('mergeEfforts', () => {
  it('keeps known efforts when a run reports none, as Haiku does', () => {
    expect(mergeEfforts([option('low'), option('high')], [])).toEqual([
      option('low'),
      option('high'),
    ]);
  });

  it('adds new efforts after the known ones and takes the reported labels', () => {
    expect(
      mergeEfforts([option('low'), option('high')], [option('high', 'High'), option('max')]),
    ).toEqual([option('low'), option('high', 'High'), option('max')]);
  });
});
