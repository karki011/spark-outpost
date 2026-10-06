import { describe, expect, it } from 'vitest';
import { feedUrlFromConfig } from './update-feed.ts';

describe('feedUrlFromConfig', () => {
  it('reads the generic feed url that electron-builder wrote into the app', () => {
    const text =
      'provider: generic\nurl: https://updates.example.com/spark/\nupdaterCacheDirName: x\n';
    expect(feedUrlFromConfig(text)).toBe('https://updates.example.com/spark');
    expect(feedUrlFromConfig("provider: generic\nurl: 'http://127.0.0.1:8080/feed'\n")).toBe(
      'http://127.0.0.1:8080/feed',
    );
    expect(
      feedUrlFromConfig(
        'provider: generic\nurl: https://updates.example.com/spark\nuseMultipleRangeRequest: false\n',
      ),
    ).toBe('https://updates.example.com/spark');
  });

  it('has no feed when the build was made without one', () => {
    expect(feedUrlFromConfig('provider: generic\n')).toBeNull();
  });
});
