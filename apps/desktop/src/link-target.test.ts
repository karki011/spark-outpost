import { describe, expect, it } from 'vitest';
import { apiOrigin } from './api-token.ts';
import { linkTarget } from './link-target.ts';

const origin = apiOrigin('127.0.0.1', 51234);

describe('link target', () => {
  it('keeps links to the API origin inside Spark, where the launch token is added', () => {
    expect(linkTarget(`${origin}/api/attachments/a1/content`, origin)).toBe('viewer');
    expect(linkTarget(`${origin}/api/tasks/t1/artifacts/plan.md`, origin)).toBe('viewer');
  });

  it('sends web and mail links to the default apps', () => {
    expect(linkTarget('https://github.com/acme/app/pull/1', origin)).toBe('browser');
    expect(linkTarget('http://localhost:3000/', origin)).toBe('browser');
    expect(linkTarget('http://127.0.0.1:51235/api/health', origin)).toBe('browser');
    expect(linkTarget('mailto:beta@example.test', origin)).toBe('browser');
  });

  it('opens nothing for other schemes', () => {
    expect(linkTarget('file:///etc/passwd', origin)).toBe('none');
    expect(linkTarget('javascript:alert(1)', origin)).toBe('none');
    expect(linkTarget('blob:http://127.0.0.1:51234/1', origin)).toBe('none');
  });
});
