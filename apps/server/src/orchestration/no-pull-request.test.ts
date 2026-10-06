import { describe, expect, it } from 'vitest';
import { NO_PULL_REQUEST, noPullRequestLine } from './no-pull-request.ts';

describe('where Full auto → PR has nothing it can commit, push or open', () => {
  it('says nothing for a git project, whatever its remote or GitHub connection', () => {
    expect(noPullRequestLine({ hasProject: true, git: true })).toBeNull();
  });

  it('names the one thing missing, most basic first', () => {
    expect(noPullRequestLine({ hasProject: false, git: false })).toBe(
      'No pull request: this chat has no project.',
    );
    expect(noPullRequestLine({ hasProject: true, git: false })).toBe(
      'No pull request: this project isn’t a git repository.',
    );
  });

  it('keeps every line short, calm and free of errors', () => {
    for (const line of Object.values(NO_PULL_REQUEST)) {
      expect(line).toMatch(/^No pull request: [^.!]+\.$/);
      expect(line.length).toBeLessThan(60);
      expect(line).not.toMatch(/error|fail|could not|can’t|cannot/i);
    }
  });
});
