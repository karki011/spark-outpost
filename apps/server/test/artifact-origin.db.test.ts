import { writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artifactPortFor } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { startArtifactOrigin, type ArtifactOrigin } from '../src/artifacts/origin-server.ts';
import { LINK_CLICKS } from '../src/artifacts/link-clicks.ts';
import { findVersion } from '../src/artifacts/store.ts';
import { chatArtifactsFolder } from '../src/chat-files/folders.ts';
import { LOCAL_HEADERS, PORT, testAppOptions } from './app-support.ts';
import { ArtifactHarness } from './artifact-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let h: ArtifactHarness;
let origin: ArtifactOrigin;
const APP = `http://127.0.0.1:${PORT}`;
const PAGE =
  '<!doctype html><p id="x">hi</p><script>fetch("http://127.0.0.1:4318/api/health")</script>';

beforeEach(async () => {
  t = await createTestDb();
  h = await ArtifactHarness.create(t);
  await h.start('auto');
  origin = await startArtifactOrigin({
    db: t.db,
    chatFolders: h.base,
    port: 0,
    frameAncestors: [APP],
  });
});

afterEach(async () => {
  await origin.close();
  await h.close();
  await t.cleanup();
});

async function published(kind = 'html', content = PAGE) {
  const { facts } = await h.call({ action: 'publish', title: 'Page', kind, content });
  const id = facts.id as string;
  const stored = await findVersion(t.db, id, 1);
  return { id, key: stored!.viewKey };
}

interface Served {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function page(path: string, host = `127.0.0.1:${origin.port}`, method = 'GET'): Promise<Served> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(
      { host: '127.0.0.1', port: origin.port, path, method, headers: { Host: host } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    sent.on('error', reject);
    sent.end();
  });
}

const api = () => request(createApp({ ...testAppOptions(t), chatFolders: h.base }));

describe('the artifact origin', { timeout: 30_000 }, () => {
  it('serves a published page under a sandbox and a closed policy, with no cookies', async () => {
    const { key } = await published();
    const response = await page(`/v/${key}`);

    expect(response.status).toBe(200);
    expect(response.text).toBe(
      `<!doctype html>${LINK_CLICKS}${PAGE.slice('<!doctype html>'.length)}`,
    );
    const policy = String(response.headers['content-security-policy']);
    expect(policy.split('; ')).toEqual(
      expect.arrayContaining([
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "connect-src 'none'",
        "frame-src 'none'",
        "form-action 'none'",
        'img-src data: blob:',
        'sandbox allow-scripts',
        `frame-ancestors ${APP}`,
      ]),
    );
    expect(policy).not.toContain('allow-same-origin');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('microphone=()');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses another host, other methods, unknown keys and a changed file', async () => {
    const { id, key } = await published();
    expect((await page(`/v/${key}`, `localhost:${origin.port}`)).status).toBe(403);
    expect((await page(`/v/${key}`, 'evil.test')).status).toBe(403);
    expect((await page(`/v/${key}`, `127.0.0.1:${origin.port}`, 'POST')).status).toBe(405);
    expect((await page(`/v/${'0'.repeat(64)}`)).status).toBe(404);
    expect((await page('/api/health')).status).toBe(404);

    const file = join(chatArtifactsFolder(h.base, h.chat.conversationId), id, '1');
    await writeFile(file, '<script>evil()</script>');
    expect((await page(`/v/${key}`)).status).toBe(404);
  });

  it('serves no Markdown or SVG as a page', async () => {
    const { key } = await published('svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect((await page(`/v/${key}`)).status).toBe(404);
  });

  it('runs on its own port, never the API port', () => {
    expect(artifactPortFor(PORT)).not.toBe(PORT);
  });
});

describe('the artifact API', { timeout: 30_000 }, () => {
  it('gives the view address on the artifact origin and the text, never a page on the API', async () => {
    const { id, key } = await published();
    const view = await api().get(`/api/artifacts/${id}/versions/1/view`).set(LOCAL_HEADERS);

    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      kind: 'html',
      viewUrl: `http://127.0.0.1:${artifactPortFor(PORT)}/v/${key}`,
      text: PAGE,
    });
    expect(view.headers['content-type']).toContain('application/json');
  });

  it('saves a version as a download and serves the paired-device page sandboxed', async () => {
    const { id } = await published();
    const saved = await api().get(`/api/artifacts/${id}/versions/1/file`).set(LOCAL_HEADERS);
    expect(saved.headers['content-disposition']).toMatch(/^attachment; filename="Page.html"/);
    expect(saved.headers['content-security-policy']).toBe("default-src 'none'; sandbox");

    const shown = await api().get(`/api/artifacts/${id}/versions/1/page`).set(LOCAL_HEADERS);
    expect(shown.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(shown.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(shown.headers['content-security-policy']).toContain("connect-src 'none'");
  });

  it('gives no view address when the artifact origin could not start', async () => {
    const { id } = await published();
    const down = request(
      createApp({ ...testAppOptions(t), chatFolders: h.base, artifactOriginDown: true }),
    );
    const view = await down.get(`/api/artifacts/${id}/versions/1/view`).set(LOCAL_HEADERS);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ viewUrl: null, text: PAGE });
  });

  it('finds nothing for a version that was never shown or does not exist', async () => {
    const { id } = await published();
    const missing = await api().get(`/api/artifacts/${id}/versions/9/view`).set(LOCAL_HEADERS);
    expect(missing.status).toBe(404);
  });
});
