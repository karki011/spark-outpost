import { describe, expect, it } from 'vitest';
import type { BrowserPaneTab } from '@spark-outpost/contracts';
import { barRows, barSections, type BarInput } from './command-bar-model.ts';

const NOW = Date.parse('2026-10-23T12:00:00Z');

function tab(id: string, title: string, url: string, active = false): BrowserPaneTab {
  return {
    id,
    title,
    url,
    owner: 'user',
    active,
    place: 'external',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    pinned: false,
    kept: false,
    handoff: null,
    driving: false,
    picking: false,
    lastAction: null,
    error: null,
  };
}

const input: BarInput = {
  text: '',
  tabs: [tab('v1', 'Deploying your app', 'https://docs.acme.dev/deploying', true)],
  favorites: [
    { id: 'f1', url: 'https://status.acme.dev/', title: 'Status' },
    { id: 'f2', url: 'https://docs.acme.dev/deploying', title: 'Deploy docs' },
  ],
  history: [
    {
      profile: 'personal',
      url: 'https://docs.acme.dev/previews',
      title: 'Deploy previews',
      visitCount: 3,
      lastVisitedAt: '2026-10-22T11:00:00Z',
    },
    {
      profile: 'personal',
      url: 'https://status.acme.dev/',
      title: 'Status',
      visitCount: 9,
      lastVisitedAt: '2026-10-23T11:58:00Z',
    },
  ],
  page: true,
};

const titles = (text: string, page = true) =>
  barRows({ ...input, text, page }, NOW).map((row) => `${row.group}:${row.title}`);

describe('the Browser view command bar', () => {
  it('lists open tabs first and each page once', () => {
    expect(titles('')).toEqual([
      'tabs:Deploying your app',
      'favorites:Status',
      'history:Deploy previews',
      'actions:Ask Spark about this page',
      'actions:New chat about this page',
      'actions:Copy link',
      'actions:Open in default browser',
    ]);
  });

  it('filters by what was typed and offers a typed web address first', () => {
    expect(titles('preview')).toEqual(['history:Deploy previews']);
    expect(titles('example.com/a')[0]).toBe('address:https://example.com/a');
    expect(titles('deploy notes')).toEqual([]);
  });

  it('leaves page actions out when no page is showing', () => {
    expect(titles('', false).filter((row) => row.startsWith('actions'))).toEqual([
      'actions:Ask Spark about this page',
      'actions:New chat about this page',
    ]);
  });

  it('shows an open tab once even when history keeps its address with a secret hidden', () => {
    const rows = barRows(
      {
        ...input,
        tabs: [tab('v1', 'Callback', 'https://app.acme.dev/cb?code=abc', true)],
        favorites: [],
        history: [
          {
            profile: 'personal',
            url: 'https://app.acme.dev/cb?code=[redacted]',
            title: 'Callback',
            visitCount: 1,
            lastVisitedAt: '2026-10-23T11:00:00Z',
          },
        ],
      },
      NOW,
    );
    expect(rows.filter((row) => row.title === 'Callback').map((row) => row.group)).toEqual([
      'tabs',
    ]);
  });

  it('leaves out history for a page open in a tab the filter hides', () => {
    const rows = barRows(
      {
        ...input,
        text: 'deploy',
        tabs: [tab('v9', 'Acme', 'https://docs.acme.dev/previews')],
        favorites: [],
      },
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it('says when a page was last visited', () => {
    const history = barRows(input, NOW).find((row) => row.group === 'history');
    expect(history?.detail).toBe('docs.acme.dev · yesterday');
  });

  it('numbers rows across sections in the order shown', () => {
    const sections = barSections(barRows(input, NOW));
    expect(sections.map((section) => section.group)).toEqual([
      'tabs',
      'favorites',
      'history',
      'actions',
    ]);
    expect(sections.flatMap((section) => section.rows.map((item) => item.index))).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });
});
