import { describe, expect, it } from 'vitest';
import { providerIssueKind } from './home.ts';

describe('providerIssueKind', () => {
  it('recognises sign-in failures', () => {
    expect(
      providerIssueKind("Claude isn't signed in. Open Settings, reconnect Claude, and try again."),
    ).toBe('auth');
    expect(providerIssueKind("Codex couldn't sign in (token expired). Open Settings.")).toBe(
      'auth',
    );
  });

  it('recognises usage limits, including Z.ai error 1113', () => {
    expect(providerIssueKind('Z.ai reported an error: {"code":"1113"}')).toBe('usage_limit');
    expect(providerIssueKind('Claude stopped with an error: usage limit reached')).toBe(
      'usage_limit',
    );
  });

  it('recognises rate limits, including Z.ai errors 1302 and 1305', () => {
    expect(providerIssueKind('Codex is rate limited. Try again in a minute.')).toBe('rate_limit');
    expect(providerIssueKind('Z.ai reported an error: 1302 high concurrency')).toBe('rate_limit');
    expect(providerIssueKind('Z.ai reported an error: 1305 overloaded')).toBe('rate_limit');
  });

  it('ignores other errors', () => {
    expect(providerIssueKind('Claude stopped unexpectedly (exit code 1). Try again.')).toBeNull();
  });
});
