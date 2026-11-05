import { describe, expect, it } from 'vitest';
import { LEAD_IN_LATEST } from '../quotes/quote-text.ts';
import { linkAddresses } from './link-urls.ts';

function hrefs(text: string): string[] {
  return linkAddresses(text).map((address) => address.href);
}

describe('linkAddresses', () => {
  it('finds http and https addresses with host and short path', () => {
    expect(linkAddresses('See https://example.com/docs/start and http://localhost:3000')).toEqual([
      { href: 'https://example.com/docs/start', host: 'example.com', path: '/docs/start' },
      { href: 'http://localhost:3000/', host: 'localhost:3000', path: '' },
    ]);
  });

  it('ignores other schemes', () => {
    expect(
      hrefs('ftp://files.example.com file:///etc/hosts javascript:alert(1) mailto:a@b.co'),
    ).toEqual([]);
    expect(hrefs('xhttps://example.com 2https://example.com')).toEqual([]);
    expect(hrefs('data:text/html,https://example.com/inner')).toEqual([
      'https://example.com/inner',
    ]);
  });

  it('refuses addresses with a login', () => {
    expect(hrefs('https://user:secret@example.com/a https://user@example.com/b')).toEqual([]);
  });

  it('drops trailing punctuation', () => {
    expect(
      hrefs('Open https://example.com/a. Then https://example.com/b, ok? https://example.com/c!'),
    ).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
    expect(hrefs('"https://example.com/q?x=1"')).toEqual(['https://example.com/q?x=1']);
  });

  it('keeps balanced parentheses and drops an unbalanced closer', () => {
    expect(hrefs('(see https://en.wikipedia.org/wiki/Spark_(software))')).toEqual([
      'https://en.wikipedia.org/wiki/Spark_(software)',
    ]);
    expect(hrefs('[docs](https://example.com/docs) and <https://example.com/angle>')).toEqual([
      'https://example.com/docs',
      'https://example.com/angle',
    ]);
  });

  it('removes duplicates by address', () => {
    expect(hrefs('https://example.com/a https://EXAMPLE.com/a https://example.com/a.')).toEqual([
      'https://example.com/a',
    ]);
  });

  it('keeps IPv6 hosts with their brackets and port', () => {
    expect(linkAddresses('http://[::1]:8080/status')).toEqual([
      { href: 'http://[::1]:8080/status', host: '[::1]:8080', path: '/status' },
    ]);
  });

  it('shortens long paths and marks a query or fragment', () => {
    const long = `https://example.com/a/${'b'.repeat(3000)}/c/last?token=1#top`;
    const [address] = linkAddresses(long);
    expect(address?.path).toBe('/a/…/last?…#…');
    expect(address?.href.length).toBeGreaterThan(3000);
  });

  it('skips code spans and fenced code', () => {
    expect(
      hrefs('Run `curl https://example.com/inline`\n```\nhttps://example.com/fenced\n```'),
    ).toEqual([]);
  });

  it('skips quoted reply text after a comment lead-in', () => {
    const text = `${LEAD_IN_LATEST}\n> https://example.com/quoted\nLook at https://example.com/mine`;
    expect(hrefs(text)).toEqual(['https://example.com/mine']);
    expect(hrefs('> https://example.com/typed-quote')).toEqual(['https://example.com/typed-quote']);
  });

  it('keeps a fence open past a line that only starts like a closing fence', () => {
    const text = '```\n```not-a-close\nhttps://example.com/inside\n```\nhttps://example.com/after';
    expect(hrefs(text)).toEqual(['https://example.com/after']);
  });

  it('trims thousands of unmatched closers quickly', () => {
    const started = performance.now();
    expect(hrefs(`https://example.com/a${')'.repeat(20_000)}`)).toEqual(['https://example.com/a']);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
