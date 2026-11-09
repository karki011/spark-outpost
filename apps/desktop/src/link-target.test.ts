import { describe, expect, it } from 'vitest';
import type { BrowserLinksIn } from '@spark-outpost/contracts';
import { apiOrigin } from './api-token.ts';
import { linkTarget, type LinkIntent } from './link-target.ts';

const origin = apiOrigin('127.0.0.1', 51234);
const PULL = 'https://github.com/acme/app/pull/1';
const ZOOM = 'https://acme.zoom.us/j/123456789';

function route(url: string, linksIn: BrowserLinksIn, intent: LinkIntent = 'follow') {
  return linkTarget(url, origin, { linksIn, intent });
}

describe('link target', () => {
  it('keeps links to the API origin inside Spark, where the launch token is added', () => {
    for (const linksIn of ['spark', 'browser'] as const) {
      for (const intent of ['follow', 'other', 'outside'] as const) {
        expect(route(`${origin}/api/attachments/a1/content`, linksIn, intent)).toBe('viewer');
      }
    }
    expect(route(`${origin}/api/tasks/t1/artifacts/plan.md`, 'spark')).toBe('viewer');
  });

  it('opens web links where Open links in says', () => {
    expect(route(PULL, 'spark')).toBe('spark');
    expect(route(PULL, 'browser')).toBe('browser');
    expect(route('http://localhost:3000/', 'spark')).toBe('spark');
    expect(route('http://127.0.0.1:51235/api/health', 'spark')).toBe('spark');
    expect(route('http://localhost:3000/', 'browser')).toBe('browser');
  });

  it('opens a link in the other place when the user asks for it', () => {
    expect(route(PULL, 'spark', 'other')).toBe('browser');
    expect(route(PULL, 'browser', 'other')).toBe('spark');
  });

  it('always sends sign-ins, Join and other outside opens to the default browser', () => {
    for (const intent of ['follow', 'other', 'outside'] as const) {
      expect(route(ZOOM, 'spark', intent)).toBe('browser');
      expect(route('https://meet.google.com/abc-defg-hij', 'spark', intent)).toBe('browser');
      expect(route('mailto:beta@example.test', 'spark', intent)).toBe('browser');
    }
    expect(route('https://accounts.google.com/o/oauth2/v2/auth?x=1', 'spark', 'outside')).toBe(
      'browser',
    );
    expect(route(PULL, 'browser', 'outside')).toBe('browser');
  });

  it('treats a page on a meeting host that is not a join link as an ordinary link', () => {
    expect(route('https://zoom.us/pricing', 'spark')).toBe('spark');
  });

  it('opens nothing for other schemes, whatever the setting', () => {
    for (const linksIn of ['spark', 'browser'] as const) {
      expect(route('file:///etc/passwd', linksIn)).toBe('none');
      expect(route('javascript:alert(1)', linksIn, 'other')).toBe('none');
      expect(route('blob:http://127.0.0.1:51234/1', linksIn)).toBe('none');
      expect(route('zoommtg://zoom.us/join?confno=1', linksIn, 'outside')).toBe('none');
      expect(route('x-apple.systempreferences:com.apple.preference', linksIn)).toBe('none');
    }
  });
});
