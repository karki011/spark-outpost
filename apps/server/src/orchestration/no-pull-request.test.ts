import { describe, expect, it } from 'vitest';
import { NO_PULL_REQUEST, noPullRequestLine, type PullRequestFacts } from './no-pull-request.ts';

const READY: PullRequestFacts = {
  hasProject: true,
  git: true,
  remoteHost: 'github.com',
  connected: true,
};

describe('where Full auto → PR cannot open a pull request', () => {
  it('says nothing when the project is on GitHub and GitHub is connected', () => {
    expect(noPullRequestLine(READY)).toBeNull();
    expect(noPullRequestLine({ ...READY, remoteHost: 'github.acme.test' })).toBeNull();
  });

  it('names the one thing missing, most basic first', () => {
    const nothing = { hasProject: false, git: false, remoteHost: null, connected: false };
    expect(noPullRequestLine(nothing)).toBe('No pull request: this chat has no project.');
    expect(noPullRequestLine({ ...nothing, hasProject: true })).toBe(
      'No pull request: this project isn’t a git repository.',
    );
    expect(noPullRequestLine({ ...READY, remoteHost: null, connected: false })).toBe(
      'No pull request: this project has no GitHub remote.',
    );
    expect(noPullRequestLine({ ...READY, remoteHost: 'gitlab.com', connected: false })).toBe(
      'No pull request: this project has no GitHub remote.',
    );
    expect(noPullRequestLine({ ...READY, connected: false })).toBe(
      'No pull request: GitHub isn’t connected.',
    );
  });

  it('keeps every line short, calm and free of errors or advice to act', () => {
    for (const line of Object.values(NO_PULL_REQUEST)) {
      expect(line).toMatch(/^No pull request: [^.!]+\.$/);
      expect(line.length).toBeLessThan(60);
      expect(line).not.toMatch(/error|fail|could not|can’t|cannot/i);
    }
  });
});
