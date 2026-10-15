import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowseHarness, PAGE } from './spark-browser-browse-support.ts';

let h: BrowseHarness;

beforeEach(async () => {
  h = await BrowseHarness.create();
});

afterEach(async () => {
  await h.close();
});

describe('acting with a ref the page replaced', () => {
  it('shows the element found again on the card and acts only on that element', async () => {
    await h.start({ mode: 'default' });
    h.fake.url = PAGE;
    h.fake.checked = { node: 42, epoch: 3, refound: true };
    const clicking = h.call('spark_browser_act', { action: 'click', ref: 'ref_1' });
    const card = await h.pending();
    expect(card.payload.sparkAction).toMatchObject({ did: 'Clicked button "Search"' });
    expect(h.fake.requests[0]).toMatchObject({ op: 'page', ref: 'ref_1', action: 'click' });
    await h.answer('confirm');
    const done = await clicking;
    expect(done.facts).toMatchObject({
      outcome: 'done',
      refound: 'ref_1 was replaced by the page; Spark found it again.',
    });
    expect(String(done.facts.note)).toContain('Refs stay valid until the page navigates');
    expect(h.fake.requests.at(-1)).toMatchObject({ op: 'act', ref: 'ref_1', node: 42, epoch: 3 });
  });

  it('says nothing about finding again when the ref still pointed at its element', async () => {
    await h.start({ mode: 'auto' });
    h.fake.url = PAGE;
    h.fake.checked = { node: 7, epoch: 1 };
    const done = await h.call('spark_browser_act', { action: 'click', ref: 'ref_1' });
    expect(done.facts).not.toHaveProperty('refound');
    expect(h.fake.requests.at(-1)).toMatchObject({ op: 'act', node: 7, epoch: 1 });
  });
});

describe('reading within a size budget', () => {
  it('passes the cap and says what was left out and that it read a dialog only', async () => {
    await h.start({ mode: 'auto' });
    h.fake.url = 'http://localhost:5173/';
    h.fake.readAnswer = { leftOut: 12, dialog: true, pageRef: 'ref_1', nextOffset: 40, total: 90 };
    const read = await h.call('spark_browser_read', { maxChars: 2_000 });
    expect(h.fake.requests.at(-1)).toMatchObject({ op: 'read', mode: 'tree', maxChars: 2_000 });
    expect(read.facts).toMatchObject({ leftOut: 12, scope: 'dialog', nextOffset: 40 });
    expect(String(read.facts.note)).toContain('12 lines were left out');
    expect(String(read.facts.note)).toContain('Pass ref ref_1 for the whole page');
  });

  it('keeps the default size and adds no notes when nothing was left out', async () => {
    await h.start({ mode: 'auto' });
    h.fake.url = 'http://localhost:5173/';
    const read = await h.call('spark_browser_read');
    expect(h.fake.requests.at(-1)).not.toHaveProperty('maxChars');
    expect(read.facts).not.toHaveProperty('leftOut');
    expect(read.facts).not.toHaveProperty('scope');
  });

  it('refuses a cap below the smallest read', async () => {
    await h.start({ mode: 'auto' });
    const read = await h.call('spark_browser_read', { maxChars: 50 });
    expect(read.result.isError).toBe(true);
    expect(h.fake.ops()).toEqual([]);
  });
});
