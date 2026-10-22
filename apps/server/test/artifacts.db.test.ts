import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARTIFACT_HTML_MIME, ARTIFACT_MAX_BYTES, artifactUri } from '@spark-outpost/contracts';
import { chatArtifactsFolder, ensureChatWorkFolder } from '../src/chat-files/folders.ts';
import { listArtifactPages } from '../src/artifacts/store.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { ArtifactHarness } from './artifact-support.ts';
import { answerCard, cardResult } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let h: ArtifactHarness;

beforeEach(async () => {
  t = await createTestDb();
  h = await ArtifactHarness.create(t);
});

afterEach(async () => {
  await h.close();
  await t.cleanup();
});

const PAGE = '<!doctype html><h1>CPI</h1><script>document.title = "x"</script>';

function auditedPublishes(): Record<string, unknown>[] {
  return (h.recorded.audited as { method?: string; params?: { action?: unknown } }[])
    .filter((entry) => entry.method === 'spark/publish_artifact')
    .map((entry) => entry.params as Record<string, unknown>);
}

describe('spark_artifact', { timeout: 30_000 }, () => {
  it('publishes at once in Auto and links an MCP Apps resource', async () => {
    await h.start('auto');

    const { result, facts } = await h.call({
      action: 'publish',
      title: 'CPI dashboard',
      kind: 'html',
      content: PAGE,
    });

    expect(facts).toMatchObject({ outcome: 'done', version: 1 });
    const id = facts.id as string;
    const uri = artifactUri(h.chat.conversationId, id);
    expect(uri).toMatch(/^ui:\/\/spark\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    expect(result.content[1]).toEqual({
      type: 'resource_link',
      uri,
      name: 'CPI dashboard',
      title: 'CPI dashboard',
      mimeType: ARTIFACT_HTML_MIME,
      _meta: {
        ui: {
          csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
          prefersBorder: true,
        },
      },
    });
    const file = join(chatArtifactsFolder(h.base, h.chat.conversationId), id, '1');
    expect(await readFile(file, 'utf8')).toBe(PAGE);
    const detail = await getConversationDetail(t.db, h.chat.conversationId);
    expect(detail?.artifactPages).toEqual([
      expect.objectContaining({
        id,
        title: 'CPI dashboard',
        kind: 'html',
        versions: [expect.objectContaining({ version: 1, runId: h.chat.runId })],
      }),
    ]);
    expect(h.recorded.events.some((event) => JSON.stringify(event).includes(id))).toBe(true);
    const [audited] = auditedPublishes();
    expect(audited).toMatchObject({
      action: { artifactId: id, version: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(JSON.stringify(audited)).not.toContain('<h1>CPI</h1>');
  });

  it('adds versions, reads any of them back and keeps the earlier one', async () => {
    await h.start('bypassPermissions');
    const first = await h.call({
      action: 'publish',
      title: 'Notes',
      kind: 'markdown',
      content: '# One',
    });
    const id = first.facts.id as string;

    const second = await h.call({ action: 'update', id, content: '# Two', title: 'Notes v2' });
    const old = await h.call({ action: 'read', id, version: 1 });
    const latest = await h.call({ action: 'read', id });

    expect(second.facts).toMatchObject({ outcome: 'done', version: 2 });
    expect(old.result.content[1]).toEqual({ type: 'text', text: '# One' });
    expect(latest.facts).toMatchObject({ version: 2, title: 'Notes v2', kind: 'markdown' });
    expect(latest.result.content[1]).toEqual({ type: 'text', text: '# Two' });
    const [page] = await listArtifactPages(t.db, h.chat.conversationId);
    expect(page?.versions.map((version) => version.version)).toEqual([1, 2]);
  });

  it('asks first in Manual and shows nothing until the user confirms', async () => {
    await h.start('default');
    const call = await h.call({
      action: 'publish',
      title: 'Chart',
      kind: 'svg',
      content: '<svg/>',
    });

    expect(call.facts).toMatchObject({ outcome: 'waiting_for_user' });
    expect(await listArtifactPages(t.db, h.chat.conversationId)).toEqual([]);

    const card = await answerCard(t, 'confirm');
    const settled = await cardResult(t, card.id);

    expect(settled.payload.sparkResult).toMatchObject({ state: 'done' });
    const [page] = await listArtifactPages(t.db, h.chat.conversationId);
    expect(page).toMatchObject({ title: 'Chart', kind: 'svg' });
  });

  it('refuses content over 2 MB, a bad svg and another chat’s artifact', async () => {
    await h.start('auto');
    const big = await h.call({
      action: 'publish',
      title: 'Big',
      kind: 'html',
      content: 'x'.repeat(ARTIFACT_MAX_BYTES + 1),
    });
    const svg = await h.call({ action: 'publish', title: 'Bad', kind: 'svg', content: '<div/>' });
    const stranger = await h.call({
      action: 'update',
      id: '33333333-3333-4333-8333-333333333333',
      content: 'x',
    });

    expect(big.result.isError).toBe(true);
    expect(big.text).toContain('the limit is 2097152');
    expect(svg.text).toContain('one <svg> document');
    expect(stranger.text).toContain('No artifact with that id in this chat');
    expect(await listArtifactPages(t.db, h.chat.conversationId)).toEqual([]);
  });

  it('removes values from the chat’s secret files before saving', async () => {
    await h.start('auto');
    const work = await ensureChatWorkFolder(h.base, h.chat.conversationId);
    await writeFile(join(work, '.env'), 'API_TOKEN=sk-live-0123456789abcdef\n');

    const { facts } = await h.call({
      action: 'publish',
      title: 'Leak',
      kind: 'html',
      content: '<p>sk-live-0123456789abcdef</p>',
    });

    const read = await h.call({ action: 'read', id: facts.id as string });
    const saved = read.result.content[1] as { text: string };
    expect(saved.text).not.toContain('sk-live-0123456789abcdef');
    expect(saved.text).toContain('[redacted');
  });

  it('removes a version file it could not record, so the next update can use that version', async () => {
    await h.start('auto');
    const first = await h.call({
      action: 'publish',
      title: 'Notes',
      kind: 'markdown',
      content: '# One',
    });
    const id = first.facts.id as string;
    await t.db.query(`
      CREATE FUNCTION refuse_version() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'database away'; END $$;
      CREATE TRIGGER refuse_version BEFORE INSERT ON artifact_page_versions
        FOR EACH ROW EXECUTE FUNCTION refuse_version();`);

    const failed = await h.call({ action: 'update', id, content: '# Two' });
    expect(failed.result.isError).toBe(true);
    const folder = join(chatArtifactsFolder(h.base, h.chat.conversationId), id);
    expect(await readdir(folder)).toEqual(['1']);

    await t.db.query('DROP TRIGGER refuse_version ON artifact_page_versions');
    const retried = await h.call({ action: 'update', id, content: '# Two' });
    expect(retried.facts).toMatchObject({ outcome: 'done', version: 2 });
  });
});
