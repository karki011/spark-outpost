import { describe, expect, it } from 'vitest';
import { CONTENT_POLICY, PAGE_POLICY } from './responses.ts';
import {
  call,
  create,
  fakeEnv,
  frameSrc,
  postForm,
  START,
  VALID_CREATE,
  type FakeEnv,
} from './test-fakes.ts';
import { REPORT_LIMIT_PER_HOUR } from './viewer.ts';

async function shell(fake: FakeEnv, id: string, now = START) {
  const response = await call(fake, `/a/${id}`, {}, now);
  return { response, html: await response.text() };
}

function expectCommonHeaders(response: Response) {
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('permissions-policy')).toContain('microphone=()');
  expect(response.headers.get('permissions-policy')).toContain('clipboard-read=()');
}

describe('viewer shell', () => {
  it('frames the content in a sandboxed iframe under a strict policy and no scripts', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    const { response, html } = await shell(fake, id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(PAGE_POLICY);
    expectCommonHeaders(response);
    expect(html).toContain('Shared from Spark Outpost · made by a user, not checked');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain(VALID_CREATE.html as string);
    expect(frameSrc(html)).toMatch(new RegExp(`^/a/${id}/content\\?t=\\d+\\.[A-Za-z0-9_-]{43}$`));
  });

  it('escapes the title everywhere it is shown', async () => {
    const fake = fakeEnv();
    const title = '<img src=x onerror=alert(1)> & "quoted"';
    const { id } = await create(fake, { ...VALID_CREATE, title });
    const { html } = await shell(fake, id);

    expect(html).not.toContain('<img src=x');
    expect(html).toContain(
      '<title>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;</title>',
    );
    expect(html).toContain(
      '<strong>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;</strong>',
    );
    expect(html).toContain('title="&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;"');
  });

  it('answers a plain 404 page for an unknown id and for other paths', async () => {
    const fake = fakeEnv();
    for (const path of [`/a/${'Z'.repeat(22)}`, '/', '/a/short', `/a/${'Z'.repeat(22)}/other`]) {
      const response = await call(fake, path);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-security-policy')).toBe(PAGE_POLICY);
      expectCommonHeaders(response);
    }
  });

  it('answers 405 with Allow for the wrong method', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    const post = await call(fake, `/a/${id}`, { method: 'POST' });
    const put = await call(fake, `/a/${id}/content`, { method: 'PUT' });
    const head = await call(fake, `/a/${id}`, { method: 'HEAD' });

    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    expect(put.status).toBe(405);
    expect(head.status).toBe(405);
    expectCommonHeaders(post);
  });

  it('fails closed with 503 when the signing key is missing or short', async () => {
    for (const signingKey of [null, 'short']) {
      const fake = fakeEnv({ signingKey });
      const { id } = await create(fake);
      expect((await call(fake, `/a/${id}`)).status).toBe(503);
      expect((await call(fake, `/a/${id}/content?t=1.x`)).status).toBe(503);
      expect((await postForm(fake, `/a/${id}/unlock`, { code: 'ABCD2345' })).status).toBe(503);
    }
  });
});

describe('content', () => {
  it('serves the stored HTML unchanged with the content policy and no cookie', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    const { html } = await shell(fake, id);
    const response = await call(fake, frameSrc(html), {}, START + 1000);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(VALID_CREATE.html);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_POLICY);
    expect(response.headers.get('set-cookie')).toBeNull();
    expectCommonHeaders(response);
  });

  it('serves the content to a frame and not to a tab opened on its address', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    const src = frameSrc((await shell(fake, id)).html);
    const as = (destination: string) =>
      call(fake, src, { headers: { 'sec-fetch-dest': destination } }, START + 1000);

    expect((await as('iframe')).status).toBe(200);
    for (const destination of ['document', 'empty', 'frame', 'embed', 'object']) {
      const response = await as(destination);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('Plan');
    }
  });

  it('refuses a missing, expired, tampered or other-share token', async () => {
    const fake = fakeEnv();
    const first = await create(fake);
    const second = await create(fake);
    const src = frameSrc((await shell(fake, first.id)).html);
    const token = new URL(src, 'https://x').searchParams.get('t')!;
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');

    expect((await call(fake, `/a/${first.id}/content`)).status).toBe(404);
    expect((await call(fake, src, {}, START + 60_000)).status).toBe(404);
    expect((await call(fake, `/a/${first.id}/content?t=${tampered}`)).status).toBe(404);
    expect((await call(fake, `/a/${second.id}/content?t=${token}`)).status).toBe(404);
    expect((await call(fake, src, {}, START + 59_000)).status).toBe(200);
  });

  it('refuses a token signed with another key', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    const other = fakeEnv({ signingKey: 'o'.repeat(48) });
    other.bucket.objects.set(`shares/${id}`, fake.bucket.objects.get(`shares/${id}`)!);
    const src = frameSrc((await shell(other, id)).html);

    expect((await call(fake, src)).status).toBe(404);
  });

  it('serves nothing from an id that has been retired, even if a page sits under it', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    const src = frameSrc((await shell(fake, id)).html);
    await fake.bucket.put(`gone/${id}`, '');

    expect((await call(fake, `/a/${id}`)).status).toBe(404);
    expect((await call(fake, src, {}, START + 1000)).status).toBe(404);
    expect(fake.bucket.objects.has(`shares/${id}`)).toBe(true);
  });

  it('serves nothing when the id is retired and replaced while its page is being read', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    const src = frameSrc((await shell(fake, id)).html);
    const stored = fake.bucket.objects.get(`shares/${id}`)!;
    const replace = async () => {
      await fake.bucket.put(`gone/${id}`, '');
      fake.bucket.objects.set(`shares/${id}`, { ...stored, value: '<h1>replaced</h1>' });
    };
    const head = fake.bucket.head.bind(fake.bucket);
    const get = fake.bucket.get.bind(fake.bucket);
    fake.bucket.head = async (key) => {
      if (key === `shares/${id}`) await replace();
      return head(key);
    };
    fake.bucket.get = async (key) => {
      if (key === `shares/${id}`) await replace();
      return get(key);
    };

    expect((await call(fake, `/a/${id}`)).status).toBe(404);
    const content = await call(fake, src, {}, START + 1000);
    expect(content.status).toBe(404);
    expect(await content.text()).not.toContain('replaced');
  });
});

describe('report', () => {
  it('stores the report and thanks the reader without deleting anything', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    const response = await postForm(fake, `/a/${id}/report`, { reason: 'Looks like phishing' });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Thanks');
    expect(response.headers.get('content-security-policy')).toBe(PAGE_POLICY);
    const reports = [...fake.bucket.objects.entries()].filter(([key]) =>
      key.startsWith('reports/'),
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]![0]).toMatch(new RegExp(`^reports/${id}/${START}-[A-Za-z0-9_-]+$`));
    expect(JSON.parse(reports[0]![1].value)).toEqual({
      id,
      reason: 'Looks like phishing',
      reportedAt: new Date(START).toISOString(),
    });
    expect(JSON.stringify(reports)).not.toContain('203.0.113.7');
    expect(fake.bucket.objects.has(`shares/${id}`)).toBe(true);
  });

  it('accepts an empty reason and refuses one over 500 characters', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    expect((await postForm(fake, `/a/${id}/report`, {})).status).toBe(200);
    expect((await postForm(fake, `/a/${id}/report`, { reason: 'x'.repeat(501) })).status).toBe(400);
  });

  it('answers 404 for an unknown share', async () => {
    const response = await postForm(fakeEnv(), `/a/${'Q'.repeat(22)}/report`, { reason: 'x' });
    expect(response.status).toBe(404);
  });

  it('limits reports per address', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    for (let index = 0; index < REPORT_LIMIT_PER_HOUR; index++) {
      expect((await postForm(fake, `/a/${id}/report`, { reason: 'x' })).status).toBe(200);
    }
    expect((await postForm(fake, `/a/${id}/report`, { reason: 'x' })).status).toBe(429);
  });
});
