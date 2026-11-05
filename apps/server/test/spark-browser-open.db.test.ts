import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowseHarness, PAGE, SITE } from './spark-browser-browse-support.ts';

let h: BrowseHarness;

beforeEach(async () => {
  h = await BrowseHarness.create();
});

afterEach(async () => {
  await h.close();
});

describe('opening a site outside this computer', () => {
  it.each([
    ['claude', 'auto'],
    ['claude', 'bypassPermissions'],
    ['codex', 'agent'],
    ['codex', 'agent-full-access'],
  ])('opens at once in %s %s and audits the address without its query', async (provider, mode) => {
    await h.start({ provider, mode });
    const opened = await h.call('spark_browser_open', { url: PAGE });
    expect(opened.facts).toMatchObject({ outcome: 'opened', place: 'external', url: PAGE });
    expect(await h.cards()).toBe(0);
    expect(h.audited('spark/browser')).toEqual([
      expect.objectContaining({
        tool: 'spark_browser_open',
        action: 'open',
        page: `${SITE}/guide/start`,
        place: 'external',
        decision: 'mode',
        runId: h.chat.runId,
      }),
    ]);
    expect(JSON.stringify(h.recorded.audited)).not.toContain('utm=1');
  });

  it.each([
    ['claude', 'default'],
    ['claude', 'acceptEdits'],
    ['claude', 'plan'],
    ['codex', 'read-only'],
    ['codex', 'ask-every-action'],
  ])('shows a card in %s %s and opens nothing until it is allowed', async (provider, mode) => {
    await h.start({ provider, mode });
    const opening = h.call('spark_browser_open', { url: PAGE });
    const card = await h.pending();
    expect(card.payload.sparkAction).toEqual({
      action: 'open_page',
      origin: SITE,
      path: '/guide/start',
    });
    expect(h.fake.ops()).toEqual([]);
    await h.answer('confirm');
    expect((await opening).facts).toMatchObject({ outcome: 'opened' });
    expect(h.audited('spark/browser').at(-1)).toMatchObject({ decision: 'user_allowed' });
  });

  it('covers the site for the rest of the chat, reading included, once allowed', async () => {
    await h.start();
    const opening = h.call('spark_browser_open', { url: PAGE });
    await h.answer('confirm');
    await opening;
    expect((await h.call('spark_browser_open', { url: `${SITE}/other` })).facts.outcome).toBe(
      'opened',
    );
    const read = await h.call('spark_browser_read');
    expect(read.texts[1]).toContain('<page_evidence url="https://docs.example.com/other"');
    expect(await h.cards()).toBe(1);
    expect(h.audited('spark/browser').map((entry) => entry.decision)).toEqual([
      'user_allowed',
      'allowed_earlier',
      'allowed_earlier',
    ]);
  });

  it('opens nothing when the user declines', async () => {
    await h.start();
    const opening = h.call('spark_browser_open', { url: PAGE });
    await h.answer('decline');
    expect((await opening).facts).toMatchObject({ outcome: 'declined', site: SITE });
    expect(h.fake.ops()).toEqual([]);
    expect(h.audited('spark/browser').at(-1)).toMatchObject({ decision: 'user_declined' });
  });

  it('opens in Accept edits without a card when the user asked for it', async () => {
    await h.start({
      mode: 'acceptEdits',
      message: 'Look up the retry settings in the docs online',
    });
    expect((await h.call('spark_browser_open', { url: PAGE })).facts.outcome).toBe('opened');
    expect(await h.cards()).toBe(0);
  });

  it('records where a redirect ended and what was asked for', async () => {
    await h.start({ mode: 'auto' });
    h.fake.landsOn = 'https://login.example.net/sso?next=x';
    await h.call('spark_browser_open', { url: PAGE });
    expect(h.audited('spark/browser')[0]).toMatchObject({
      page: 'https://login.example.net/sso',
      asked: `${SITE}/guide/start`,
    });
  });

  it('says so and audits it when the browser refuses one of Spark’s own ports', async () => {
    await h.start({ mode: 'bypassPermissions' });
    h.fake.refuses = 'That address is on one of Spark’s own ports.';
    const refused = await h.call('spark_browser_open', { url: 'http://rebind.example.com:32682/' });
    expect(refused.result.isError).toBe(true);
    expect(refused.texts[0]).toContain('own ports');
    expect(h.audited('spark/browser')[0]).toMatchObject({ decision: 'refused' });
  });

  it.each(['javascript:alert(1)', 'chrome://settings', 'https://me:pw@example.com/'])(
    'refuses %s before the browser is asked',
    async (url) => {
      await h.start({ mode: 'bypassPermissions' });
      expect((await h.call('spark_browser_open', { url })).result.isError).toBe(true);
      expect(h.fake.ops()).toEqual([]);
    },
  );

  it('keeps a local page as it was: no card in an asking mode', async () => {
    await h.start({ mode: 'default' });
    const opened = await h.call('spark_browser_open', { url: 'http://localhost:5173/' });
    expect(opened.facts).toMatchObject({ outcome: 'opened', place: 'local' });
    expect(await h.cards()).toBe(0);
    expect(h.audited('spark/browser')[0]).toMatchObject({ decision: 'local' });
  });
});

describe('sending after the turn read something sensitive', () => {
  it('flags an open once per site when the mode runs it, and typing into the page just read adds nothing', async () => {
    await h.start({ mode: 'bypassPermissions' });
    await h.call('spark_chats');
    await h.call('spark_browser_open', { url: PAGE });
    await h.call('spark_browser_open', { url: `${SITE}/again` });
    await h.call('spark_browser_read');
    await h.call('spark_browser_act', { action: 'type', ref: 'ref_2', text: 'hello' });
    expect(await h.flags()).toEqual([
      expect.stringMatching(
        /sent data to docs\.example\.com after reading private work data \(spark_chats\)$/,
      ),
    ]);
    expect(h.audited('spark/egress')).toEqual([
      expect.objectContaining({ outcome: 'ran', sendsTo: 'to docs.example.com' }),
      expect.objectContaining({ outcome: 'ran', sendsTo: 'to docs.example.com' }),
      expect.objectContaining({ outcome: 'ran', subject: `Type into ${SITE}/again` }),
    ]);
    expect(await h.cards()).toBe(0);
  });

  it('does not count the site’s own page as something read before sending to it', async () => {
    await h.start({ mode: 'auto' });
    await h.call('spark_browser_open', { url: PAGE });
    await h.call('spark_browser_read');
    await h.call('spark_browser_act', { action: 'type', ref: 'ref_2', text: 'hello' });
    await h.call('spark_browser_open', { url: 'https://other.example.org/' });
    expect(await h.flags()).toEqual([
      expect.stringMatching(
        /sent data to other\.example\.org after reading web page https:\/\/docs\.example\.com$/,
      ),
    ]);
  });

  it('puts the note on the card when the mode asks, and raises no flag', async () => {
    await h.start({ mode: 'default' });
    await h.call('spark_chats');
    const opening = h.call('spark_browser_open', { url: PAGE });
    const card = await h.answer('confirm');
    await opening;
    expect(card.payload.observed).toEqual(['private work data (spark_chats)']);
    expect(h.audited('spark/egress')).toEqual([
      expect.objectContaining({ approvalId: card.id, sendsTo: 'to docs.example.com' }),
    ]);
    expect(await h.flagTitles()).toEqual([]);
  });
});
