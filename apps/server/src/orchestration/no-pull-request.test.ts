import { describe, expect, it } from 'vitest';
import { NO_PULL_REQUEST } from './no-pull-request.ts';

describe('where Full auto → PR has nothing it can commit, push or open', () => {
  it('keeps every line short, calm and free of errors', () => {
    for (const line of Object.values(NO_PULL_REQUEST)) {
      expect(line).toMatch(/^No pull request: [^.!]+\.$/);
      expect(line.length).toBeLessThan(60);
      expect(line).not.toMatch(/error|fail|could not|can’t|cannot/i);
    }
  });
});
