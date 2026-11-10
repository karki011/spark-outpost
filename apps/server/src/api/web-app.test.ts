import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { appContentSecurityPolicy, artifactOrigin } from '@spark-outpost/contracts';
import { webApp } from './web-app.ts';

const APP_CONTENT_SECURITY_POLICY = appContentSecurityPolicy(artifactOrigin(4318));

function appServing(root = mkdtempSync(path.join(tmpdir(), 'spark-web-'))) {
  writeFileSync(path.join(root, 'index.html'), '<title>Spark Outpost</title>');
  writeFileSync(path.join(root, 'theme.css'), 'body {}');
  const web = webApp(root, APP_CONTENT_SECURITY_POLICY);
  const app = express();
  app.use(web.files);
  app.get('/api/hello', (_req, res) => {
    res.json({ from: 'api' });
  });
  app.use(web.page);
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });
  return app;
}

describe('webApp', () => {
  it('serves the built files and the page for app paths', async () => {
    const app = appServing();
    expect((await request(app).get('/theme.css')).text).toBe('body {}');
    expect((await request(app).get('/')).text).toContain('Spark Outpost');
    expect((await request(app).get('/settings/providers')).text).toContain('Spark Outpost');
  });

  it('sends the strict content security policy with the page and its files', async () => {
    const app = appServing();
    for (const path of ['/', '/index.html', '/island', '/mac-indicator', '/theme.css']) {
      const response = await request(app).get(path).expect(200);
      expect(response.headers['content-security-policy']).toBe(APP_CONTENT_SECURITY_POLICY);
    }
    const directives = APP_CONTENT_SECURITY_POLICY.split('; ');
    expect(directives).toContain("script-src 'self'");
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("object-src 'none'");
    expect(directives).toContain("frame-src 'self' http://127.0.0.1:14318");
    expect(directives).toContain("base-uri 'self'");
    expect(APP_CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    const missing = await request(app).get('/api/missing');
    expect(missing.headers['content-security-policy']).toBeUndefined();
  });

  it('serves the page from a folder inside a dot folder', async () => {
    const root = path.join(mkdtempSync(path.join(tmpdir(), 'spark-web-')), '.worktree', 'dist');
    mkdirSync(root, { recursive: true });
    const response = await request(appServing(root)).get('/settings').expect(200);
    expect(response.text).toContain('Spark Outpost');
  });

  it('leaves unknown API paths to the API', async () => {
    const response = await request(appServing()).get('/api/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found.' });
  });

  it('serves built files ahead of the API without letting a file shadow an API path', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spark-web-'));
    mkdirSync(path.join(root, 'api'));
    writeFileSync(path.join(root, 'api', 'hello'), 'not the api');
    writeFileSync(path.join(root, 'api', 'other'), 'not the api');
    const app = appServing(root);
    expect((await request(app).get('/api/hello').expect(200)).body).toEqual({ from: 'api' });
    const other = await request(app).get('/api/other');
    expect(other.status).toBe(404);
    expect(other.body).toEqual({ error: 'Not found.' });
    expect(other.headers['content-security-policy']).toBeUndefined();
  });

  describe('caching and compression', () => {
    const SCRIPT = 'export const spark = 1;'.repeat(20);

    function appWithAssets() {
      const root = mkdtempSync(path.join(tmpdir(), 'spark-web-'));
      mkdirSync(path.join(root, 'assets'));
      writeFileSync(path.join(root, 'assets', 'index-abc123.js'), SCRIPT);
      writeFileSync(path.join(root, 'assets', 'index-abc123.js.br'), brotliCompressSync(SCRIPT));
      writeFileSync(path.join(root, 'assets', 'index-abc123.js.gz'), gzipSync(SCRIPT));
      writeFileSync(path.join(root, 'assets', 'gz-only.js'), SCRIPT);
      writeFileSync(path.join(root, 'assets', 'gz-only.js.gz'), gzipSync(SCRIPT));
      writeFileSync(path.join(root, 'assets', 'plain.js'), SCRIPT);
      writeFileSync(path.join(root, 'sw.js'), 'self.skipWaiting();');
      writeFileSync(path.join(root, 'index.html.br'), brotliCompressSync('<title>Spark</title>'));
      return appServing(root);
    }

    it('caches hashed assets for a year and never caches the page or worker that way', async () => {
      const app = appWithAssets();
      const asset = await request(app).get('/assets/plain.js').expect(200);
      expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      for (const url of ['/', '/index.html', '/sw.js', '/theme.css', '/settings']) {
        const response = await request(app).get(url).expect(200);
        expect(response.headers['cache-control'] ?? '').not.toContain('immutable');
      }
    });

    it('serves brotli, then gzip, with the original content type', async () => {
      const app = appWithAssets();
      const brotli = await request(app)
        .get('/assets/index-abc123.js')
        .set('Accept-Encoding', 'gzip, br')
        .expect(200);
      expect(brotli.headers['content-encoding']).toBe('br');
      expect(brotli.headers['content-type']).toContain('javascript');
      expect(brotli.headers['vary']).toContain('Accept-Encoding');
      expect(brotli.headers['cache-control']).toContain('immutable');
      expect(brotli.text).toBe(SCRIPT);
      const gzip = await request(app)
        .get('/assets/index-abc123.js')
        .set('Accept-Encoding', 'gzip')
        .expect(200);
      expect(gzip.headers['content-encoding']).toBe('gzip');
      expect(gzip.headers['content-type']).toContain('javascript');
      expect(gzip.text).toBe(SCRIPT);
      const fallback = await request(app)
        .get('/assets/gz-only.js')
        .set('Accept-Encoding', 'br, gzip')
        .expect(200);
      expect(fallback.headers['content-encoding']).toBe('gzip');
    });

    it('falls back to the plain file and still varies on the encoding', async () => {
      const app = appWithAssets();
      for (const encoding of ['identity', 'br;q=0', 'deflate']) {
        const pending = request(app).get('/assets/index-abc123.js');
        const response = await pending.set('Accept-Encoding', encoding);
        expect(response.headers['content-encoding']).toBeUndefined();
        expect(response.headers['vary']).toContain('Accept-Encoding');
        expect(response.text).toBe(SCRIPT);
      }
      const none = await request(app).get('/assets/plain.js').set('Accept-Encoding', 'br');
      expect(none.headers['content-encoding']).toBeUndefined();
      expect(none.text).toBe(SCRIPT);
    });

    it('compresses the page, keeps HEAD working and leaves other types alone', async () => {
      const app = appWithAssets();
      const page = await request(app).get('/settings').set('Accept-Encoding', 'br').expect(200);
      expect(page.headers['content-encoding']).toBe('br');
      expect(page.headers['content-type']).toContain('text/html');
      const head = await request(app)
        .head('/assets/index-abc123.js')
        .set('Accept-Encoding', 'gzip')
        .expect(200);
      expect(head.headers['content-encoding']).toBe('gzip');
      const css = await request(app).get('/theme.css').set('Accept-Encoding', 'br').expect(200);
      expect(css.headers['content-encoding']).toBeUndefined();
    });
  });
});
