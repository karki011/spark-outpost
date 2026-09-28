import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { webApp } from './web-app.ts';

function appServing() {
  const root = mkdtempSync(path.join(tmpdir(), 'spark-web-'));
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

  it('leaves unknown API paths to the API', async () => {
    const response = await request(appServing()).get('/api/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found.' });
  });
});
