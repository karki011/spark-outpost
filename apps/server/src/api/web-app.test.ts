import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { APP_CONTENT_SECURITY_POLICY } from '@spark-outpost/contracts';
import { webApp } from './web-app.ts';

function appServing(root = mkdtempSync(path.join(tmpdir(), 'spark-web-'))) {
  writeFileSync(path.join(root, 'index.html'), '<title>Spark Outpost</title>');
  writeFileSync(path.join(root, 'theme.css'), 'body {}');
  const app = express();
  app.use(webApp(root));
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
});
