import { afterEach, describe, expect, it } from 'vitest';
import {
  evidence,
  sparkCards,
  startAtlassian,
  stopAtlassian,
  type AtlassianHarness,
} from './atlassian-support.ts';
import { confirmCard } from './spark-mcp-support.ts';

let h: AtlassianHarness;

afterEach(async () => {
  if (h) await stopAtlassian(h);
});

const page = (id: string) => h.stubs.confluence.pages.find((entry) => entry.id === id)!;

describe('spark_confluence reads', () => {
  it('searches with CQL and reads a page as text with its version', async () => {
    h = await startAtlassian('Search the wiki for the release checklist', 'auto');
    const found = evidence(
      (await h.tools.call('spark_confluence', { action: 'search', cql: 'text ~ "release"' })).text,
    );
    expect(found.found).toEqual([
      expect.objectContaining({ id: '9001', title: 'Release checklist', space: 'ENG' }),
    ]);
    expect(h.stubs.confluence.cql).toEqual(['text ~ "release"']);
    const read = evidence(
      (await h.tools.call('spark_confluence', { action: 'read', pageId: '9001' })).text,
    );
    expect(read.page).toMatchObject({
      version: 3,
      space: { key: 'ENG', name: 'Engineering' },
      body: '## Before the release\n\n- Run **pnpm check**\n- Write notes\n\nAsk & wait for review.',
      url: expect.stringContaining('/wiki/spaces/ENG/pages/9001'),
    });
    expect(h.recordedObservations).toContain('Confluence data (spark_confluence)');
  });

  it('says the page is missing', async () => {
    h = await startAtlassian('Read page 1234', 'auto');
    const result = await h.tools.call('spark_confluence', { action: 'read', pageId: '1234' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Confluence denied access');
    expect(result.text).toContain('(404)');
  });

  it('is not offered when the token cannot reach Confluence', async () => {
    h = await startAtlassian('Read page 9001', 'auto');
    await h.t.db.query(`UPDATE ticket_connections SET confluence_on = false`);
    const result = await h.tools.call('spark_confluence', { action: 'read', pageId: '9001' });
    expect(result.text).toContain("Confluence isn't on");
  });
});

describe('spark_confluence_edit', () => {
  it('saves a new version from Markdown when the version the agent read is current', async () => {
    h = await startAtlassian('Update the release checklist page', 'auto');
    const saved = await h.tools.call('spark_confluence_edit', {
      action: 'update',
      pageId: '9001',
      version: 3,
      body: '## Steps\n\n- Tag <v1>\n- Ship',
    });
    expect(saved.json()).toMatchObject({ outcome: 'done', version: 4 });
    expect(page('9001')).toMatchObject({
      version: 4,
      title: 'Release checklist',
      storage: '<h2>Steps</h2><ul><li>Tag &lt;v1&gt;</li><li>Ship</li></ul>',
    });
    expect(h.sent).toEqual([]);
  });

  it('refuses an update from an old version so the agent reads again', async () => {
    h = await startAtlassian('Update the release checklist page', 'auto');
    const refused = await h.tools.call('spark_confluence_edit', {
      action: 'update',
      pageId: '9001',
      version: 2,
      body: 'Stale',
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('is at version 3 now, not 2');
    expect(page('9001').version).toBe(3);
    expect(await sparkCards(h.t)).toEqual([]);
  });

  it('saves nothing when someone changed the page while the card waited', async () => {
    h = await startAtlassian('Update the release checklist page', 'default');
    await h.tools.call('spark_confluence_edit', {
      action: 'update',
      pageId: '9001',
      version: 3,
      title: 'Release list',
    });
    page('9001').version = 4;
    const card = await confirmCard(h.t);
    expect(card.payload.sparkAction).toMatchObject({
      before: { title: 'Release checklist' },
      after: { title: 'Release list' },
    });
    expect(card.payload.sparkResult).toMatchObject({ state: 'failed' });
    expect(card.payload.sparkResult?.message).toContain('version 4 now, not 3');
    expect(page('9001').title).toBe('Release checklist');
  });

  it('posts no comment when the page changed while the card waited', async () => {
    h = await startAtlassian('Comment on the release page', 'default');
    await h.tools.call('spark_confluence_edit', {
      action: 'comment',
      pageId: '9001',
      body: 'Approved text',
    });
    page('9001').version = 4;
    const card = await confirmCard(h.t);
    expect(card.payload.sparkResult?.message).toContain('version 4 now, not 3');
    expect(h.stubs.confluence.comments).toEqual([]);
  });

  it('reports a conflict from Confluence as a reason to read again', async () => {
    h = await startAtlassian('Update the release checklist page', 'auto');
    h.stubs.confluence.faults.set('PUT /wiki/api/v2/pages/9001', 409);
    const result = await h.tools.call('spark_confluence_edit', {
      action: 'update',
      pageId: '9001',
      version: 3,
      body: 'Late',
    });
    expect(result.text).toContain('read it again');
    expect(page('9001').version).toBe(3);
  });

  it('creates a page under a parent and comments on it', async () => {
    h = await startAtlassian('Create a wiki page for the launch', 'auto');
    const created = await h.tools.call('spark_confluence_edit', {
      action: 'create',
      space: 'ENG',
      parentId: '9001',
      title: 'Launch notes',
      body: 'Hello **team**',
    });
    expect(created.json()).toMatchObject({ outcome: 'done', pageId: '9003' });
    expect(page('9003')).toMatchObject({
      parentId: '9001',
      storage: '<p>Hello <strong>team</strong></p>',
    });
    const comment = await h.tools.call('spark_confluence_edit', {
      action: 'comment',
      pageId: '9003',
      body: 'Looks good',
    });
    expect(comment.json()).toMatchObject({ outcome: 'done' });
    expect(h.stubs.confluence.comments).toEqual([
      expect.objectContaining({ pageId: '9003', storage: '<p>Looks good</p>' }),
    ]);
  });

  it('asks before moving a page to the trash even in Bypass permissions', async () => {
    h = await startAtlassian('Delete the rollback page', 'bypassPermissions');
    const waiting = await h.tools.call('spark_confluence_edit', {
      action: 'delete',
      pageId: '9002',
    });
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect(page('9002').status).toBe('current');
    const card = await confirmCard(h.t);
    expect(card.options[0]!.name).toBe('Move to trash');
    expect(page('9002').status).toBe('trashed');
  });

  it('reports a rate limit and leaves the page as it was', async () => {
    h = await startAtlassian('Comment on the release page', 'auto');
    h.stubs.confluence.faults.set('POST /wiki/api/v2/footer-comments', 429);
    const result = await h.tools.call('spark_confluence_edit', {
      action: 'comment',
      pageId: '9001',
      body: 'Ping',
    });
    expect(result.text).toContain('limiting requests (429)');
    expect(h.stubs.confluence.comments).toEqual([]);
  });
});
