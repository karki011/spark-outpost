import { describe, expect, it } from 'vitest';
import { plainLine } from './plain-line.ts';

describe('plain one-line text from Markdown', () => {
  it('drops list markers, emphasis, code ticks, headings and link targets', () => {
    expect(
      plainLine('# Summary\n- **Claude** is your `default` model\n- See [the docs](https://x.y)'),
    ).toBe('Summary Claude is your default model See the docs');
    expect(plainLine('Ran ```\nrm -rf\n``` then _stopped_')).toBe('Ran then stopped');
  });
});
