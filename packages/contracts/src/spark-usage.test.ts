import { describe, expect, it } from 'vitest';
import { namesSpark, sparkUsedInLine } from './spark-usage.ts';

describe('sparkUsedInLine', () => {
  it('names the one step a Spark runs', () => {
    expect(sparkUsedInLine({ id: 'risk', name: 'Risk', steps: [2], stepCount: 2 })).toBe(
      'Workflow · step 2 of 2',
    );
  });

  it('lists every step when a Spark runs several', () => {
    expect(sparkUsedInLine({ id: 'risk', name: 'Risk', steps: [1, 3], stepCount: 4 })).toBe(
      'Workflow · steps 1, 3 of 4',
    );
  });
});

describe('namesSpark', () => {
  it('finds a whole name in any case, with or without @', () => {
    expect(namesSpark('Hand risky slices to fable specialist.', 'Fable Specialist')).toBe(true);
    expect(namesSpark('Ask @Pip, then report.', 'Pip')).toBe(true);
  });

  it('ignores a name inside a longer word and an empty name', () => {
    expect(namesSpark('Check the pipeline.', 'Pip')).toBe(false);
    expect(namesSpark('Anything', '  ')).toBe(false);
  });
});
