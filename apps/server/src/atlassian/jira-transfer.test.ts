import { describe, expect, it } from 'vitest';
import { mediaTarget } from './jira-transfer.ts';

const SITE = 'https://acme.atlassian.net';

describe('where Spark follows an attachment download', () => {
  it('follows Atlassian media hosts over https and the site itself', () => {
    expect(mediaTarget('https://api.media.atlassian.com/file/1/binary?token=x', SITE)).toBe(
      'https://api.media.atlassian.com/file/1/binary?token=x',
    );
    expect(mediaTarget('/secure/attachment/1/a.txt', SITE)).toBe(
      'https://acme.atlassian.net/secure/attachment/1/a.txt',
    );
  });

  it('refuses other hosts, plain http and addresses with a login', () => {
    expect(mediaTarget('https://evil.example/file', SITE)).toBeNull();
    expect(mediaTarget('https://atlassian.net.evil.example/file', SITE)).toBeNull();
    expect(mediaTarget('http://api.media.atlassian.com/file', SITE)).toBeNull();
    expect(mediaTarget('https://user:pw@api.media.atlassian.com/file', SITE)).toBeNull();
  });
});
