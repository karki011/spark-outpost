import { describe, expect, it } from 'vitest';
import { jiraSiteHost, jiraSiteUrl } from './jira-site.ts';

describe('jiraSiteUrl', () => {
  it('adds https to a bare site name', () => {
    expect(jiraSiteUrl('yourcompany.atlassian.net')).toBe('https://yourcompany.atlassian.net');
  });

  it('drops trailing slashes, paths, queries and surrounding spaces', () => {
    expect(jiraSiteUrl('  https://yourcompany.atlassian.net/  ')).toBe(
      'https://yourcompany.atlassian.net',
    );
    expect(jiraSiteUrl('https://YourCompany.atlassian.net/jira/your-work?x=1')).toBe(
      'https://yourcompany.atlassian.net',
    );
  });

  it('keeps an explicit scheme and port', () => {
    expect(jiraSiteUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
  });

  it('leaves empty and unparseable input for validation to reject', () => {
    expect(jiraSiteUrl('   ')).toBe('');
    expect(jiraSiteUrl('not a site')).toBe('not a site');
  });
});

describe('jiraSiteHost', () => {
  it('shows an https site without its scheme', () => {
    expect(jiraSiteHost('https://yourcompany.atlassian.net/')).toBe('yourcompany.atlassian.net');
  });

  it('keeps a non-https scheme visible', () => {
    expect(jiraSiteHost('http://localhost:3000')).toBe('http://localhost:3000');
  });
});
