import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCOUT_ANTENNA, SCOUT_BODY, SCOUT_SPARK } from './scout-shape.ts';

const bootPage = readFileSync(path.join(import.meta.dirname, '../../public/boot.html'), 'utf8');

describe('boot page blob', () => {
  it('draws the same Spark shape as the app', () => {
    for (const shape of [SCOUT_ANTENNA, SCOUT_SPARK, SCOUT_BODY]) {
      expect(bootPage).toContain(`d="${shape}"`);
    }
  });
});
