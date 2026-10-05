import { describe, expect, it } from 'vitest';
import { firstSentence, plainLine } from './plain-line.ts';

describe('plain one-line text from Markdown', () => {
  it('drops list markers, emphasis, code ticks, headings and link targets', () => {
    expect(
      plainLine('# Summary\n- **Claude** is your `default` model\n- See [the docs](https://x.y)'),
    ).toBe('Summary Claude is your default model See the docs');
    expect(plainLine('Ran ```\nrm -rf\n``` then _stopped_')).toBe('Ran then stopped');
  });

  it('keeps the first sentence, without cutting at a file name or version', () => {
    expect(firstSentence('**Done.** The totals now add up.')).toBe('Done.');
    expect(firstSentence('Fixed `invoice.ts` for v1.2 totals! Next: tests.')).toBe(
      'Fixed invoice.ts for v1.2 totals!',
    );
    expect(firstSentence('## Summary\n- No sentence end here')).toBe(
      'Summary No sentence end here',
    );
    expect(firstSentence('word '.repeat(60), 40)).toMatch(/^.{1,39}…$/);
    expect(firstSentence('```\ncode only\n```')).toBe('');
    expect(firstSentence('All done\n\nAI review by Hawk: unclear.')).toBe('All done');
  });
});
