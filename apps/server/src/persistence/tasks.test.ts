import { describe, expect, it } from 'vitest';
import { taskTitle } from './tasks.ts';

describe('taskTitle', () => {
  it('keeps a long first line up to 120 characters, cut at a word', () => {
    const request =
      'Live Spark test — do not merge. Add one line at the very end of docs/guide/README.md that says: "> Note: this branch is a live Spark test — do not merge." Change nothing else.';
    const title = taskTitle(request);
    expect(title).toBe(
      'Live Spark test — do not merge. Add one line at the very end of docs/guide/README.md that says: "> Note: this branch is…',
    );
    expect(title.length).toBeLessThanOrEqual(121);
  });

  it('keeps a short title whole', () => {
    expect(taskTitle('Tidy the notes\nwith details')).toBe('Tidy the notes');
  });
});
