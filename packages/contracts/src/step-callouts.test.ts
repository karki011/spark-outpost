import { describe, expect, it } from 'vitest';
import { awaitsCalloutInput, calloutTarget, calloutTool, calloutWords } from './step-callouts.ts';

describe('step callouts', () => {
  it("knows Spark's callout tools by Claude, Codex and bare names, and web steps by title", () => {
    expect(calloutTool('mcp__spark__spark_browser_open', null)).toBe('spark_browser_open');
    expect(calloutTool('mcp__spark_outpost__spark_artifact', null)).toBe('spark_artifact');
    expect(calloutTool('mcp.spark.spark_mac_act', null)).toBe('spark_mac_act');
    expect(calloutTool('spark_browser_read', null)).toBe('spark_browser_read');
    expect(calloutTool('WebFetch', 'Fetch')).toBe('WebFetch');
    expect(calloutTool(undefined, 'Web search: react 20')).toBe('WebSearch');
    expect(calloutTool(undefined, 'Searched the web')).toBe('WebSearch');
    expect(calloutTool(null, 'Fetched docs.example.com')).toBe('WebFetch');
  });

  it("leaves other tools, and another server's tool of the same name, in the fold", () => {
    expect(calloutTool('mcp__other__spark_browser_open', null)).toBeNull();
    expect(calloutTool('mcp__spark__spark_mac_read', null)).toBeNull();
    expect(calloutTool('mcp__spark__spark_browser_tabs', null)).toBeNull();
    expect(calloutTool('Bash', '`curl https://example.com`')).toBeNull();
    expect(calloutTool('Read', 'Read `a.ts`')).toBeNull();
    expect(calloutTool('Grep', 'Search "x"')).toBeNull();
  });

  it('keeps only the host of an address, never its path, query or login', () => {
    const open = { url: 'https://me:pw@www.cloudzero.com/pricing?token=abc#top' };
    expect(calloutTarget('mcp__spark__spark_browser_open', null, open)).toBe('www.cloudzero.com');
    const fetch = { url: 'https://docs.example.com/guide?page=2', prompt: 'sum it up' };
    expect(calloutTarget('WebFetch', 'Fetch https://docs.example.com/guide', fetch)).toBe(
      'docs.example.com',
    );
    expect(calloutTarget('WebFetch', 'Fetch https://a.example.org/x', {})).toBe('a.example.org');
    expect(calloutTarget('spark_browser_open', null, { url: 'file:///etc/hosts' })).toBeNull();
  });

  it('reads Codex arguments wrapped under arguments and a search query from the title', () => {
    const wrapped = { server: 'spark', arguments: { url: 'https://example.com/a' } };
    expect(calloutTarget('mcp.spark.spark_browser_open', null, wrapped)).toBe('example.com');
    expect(calloutTarget(null, 'Web search: react 20', {})).toBe('react 20');
    expect(calloutTarget(null, 'Web search', { query: 'acp  spec' })).toBe('acp spec');
    expect(calloutTarget('WebSearch', 'Search "vite 8"', {})).toBe('vite 8');
  });

  it('never keeps typed text or page content', () => {
    const typed = { action: 'type', ref: 'ref_3', text: 'my secret note' };
    expect(calloutTarget('spark_browser_act', null, typed)).toBe('type');
    const key = { action: 'key', key: 'Enter', text: 'ignored' };
    expect(calloutTarget('spark_browser_act', null, key)).toBe('key Enter');
    const page = { action: 'publish', title: 'Spend report', content: '<h1>Secret</h1>' };
    expect(calloutTarget('spark_artifact', null, page)).toBe('publish Spend report');
    expect(calloutTarget('spark_browser_act', null, { action: 'drag' })).toBeNull();
  });

  it('names the Mac app and the menu path', () => {
    const menu = { action: 'menu', app: 'Notes', menu: ['File', 'Save'] };
    expect(calloutTarget('spark_mac_act', null, menu)).toBe('menu Notes › File › Save');
    expect(
      calloutTarget('spark_mac_act', null, { action: 'press', app: 'Notes', ref: 'ax_4' }),
    ).toBe('press Notes');
    const key = { action: 'key', app: 'Notes', key: 'return' };
    expect(calloutTarget('spark_mac_act', null, key)).toBe('key return Notes');
  });

  it('waits for the input of a Spark callout tool before it names the step', () => {
    expect(awaitsCalloutInput('mcp__spark__spark_browser_open', {})).toBe(true);
    expect(awaitsCalloutInput('mcp__spark__spark_browser_open', undefined)).toBe(true);
    expect(awaitsCalloutInput('mcp.spark.spark_mac_act', { arguments: {} })).toBe(true);
    expect(awaitsCalloutInput('mcp__spark__spark_browser_open', { url: 'https://a.io' })).toBe(
      false,
    );
    expect(awaitsCalloutInput('mcp__spark__spark_browser_read', {})).toBe(false);
    expect(awaitsCalloutInput('WebSearch', {})).toBe(false);
  });

  it('words each callout in the past once done and in the present while it runs', () => {
    expect(calloutWords('spark_browser_open', 'cloudzero.com', false)).toEqual({
      verb: 'Opened',
      target: 'cloudzero.com',
    });
    expect(calloutWords('spark_browser_open', 'cloudzero.com', true).verb).toBe('Opening');
    expect(calloutWords('spark_browser_open', null, false)).toEqual({
      verb: 'Opened a page',
      target: null,
    });
    expect(calloutWords('spark_browser_read', null, false).verb).toBe('Read the page');
    expect(calloutWords('spark_browser_act', 'key Enter', false)).toEqual({
      verb: 'Pressed',
      target: 'Enter',
    });
    expect(calloutWords('spark_browser_act', 'type', true).verb).toBe('Typing into a field');
    expect(calloutWords('WebSearch', 'react 20', false)).toEqual({
      verb: 'Searched the web for',
      target: 'react 20',
    });
    expect(calloutWords('WebSearch', null, true).verb).toBe('Searching the web');
    expect(calloutWords('WebFetch', 'example.com', false).verb).toBe('Fetched');
    expect(calloutWords('spark_artifact', 'publish Spend report', false)).toEqual({
      verb: 'Made a page:',
      target: 'Spend report',
    });
    expect(calloutWords('spark_artifact', null, false).verb).toBe('Made a page');
    expect(calloutWords('spark_mac_act', 'menu Notes › File › Save', false)).toEqual({
      verb: 'Chose File › Save in',
      target: 'Notes',
    });
    expect(calloutWords('spark_mac_act', 'press Notes', false)).toEqual({
      verb: 'Pressed a button in',
      target: 'Notes',
    });
    expect(calloutWords('spark_mac_act', 'key return Notes', true)).toEqual({
      verb: 'Pressing return in',
      target: 'Notes',
    });
    expect(calloutWords('spark_mac_act', null, false).verb).toBe('Acted in a Mac app');
  });
});
