import { describe, expect, it } from 'vitest';
import { answerFailed, isNotLoadedPage, loadFailed, notLoadedPage } from './load-state.ts';

const HOST = 'studio.tail1234.ts.net';

describe('the did-not-load page', () => {
  it('names the Mac and its address and links back to the entry', () => {
    const url = notLoadedPage('Studio Mac', HOST, `https://${HOST}/`);
    expect(isNotLoadedPage(url)).toBe(true);
    const html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(html).toContain('<h1>Studio Mac did not load</h1>');
    expect(html).toContain(`${HOST} is not answering.`);
    expect(html).toContain(`<a href="https://${HOST}/" autofocus>Try again</a>`);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('<script');
  });

  it('escapes a name that holds markup', () => {
    const url = notLoadedPage('<img src=x onerror=1> & "co"', HOST, `https://${HOST}/`);
    const html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(html).toContain('&lt;img src=x onerror=1&gt; &amp; &quot;co&quot; did not load');
    expect(html).not.toContain('<img');
  });

  it('is not mistaken for a page on the other Mac', () => {
    expect(isNotLoadedPage(`https://${HOST}/`)).toBe(false);
  });
});

describe('what counts as not loading', () => {
  it('ignores a load the window itself cancelled and takes any other error', () => {
    expect(loadFailed(-3)).toBe(false);
    expect(loadFailed(-105)).toBe(true);
    expect(loadFailed(-102)).toBe(true);
  });

  it('takes a gateway error or an address nothing serves and leaves an ordinary answer alone', () => {
    expect(answerFailed(502)).toBe(true);
    expect(answerFailed(404)).toBe(true);
    expect(answerFailed(503)).toBe(true);
    expect(answerFailed(200)).toBe(false);
    expect(answerFailed(401)).toBe(false);
  });
});
