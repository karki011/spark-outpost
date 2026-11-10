// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../api/client.ts';
import { setUpOutpostView, client, show, view } from './outpost-view-harness.tsx';
import { API_CHAT, DOCS_CHAT, FE_CHAT, chat, detail, post } from './test-fixtures.ts';

const rendered = vi.hoisted(() => ({ pills: 0 }));

vi.mock('./StatusPill.tsx', () => ({
  StatusPill: ({ label }: { label: string }) => {
    rendered.pills += 1;
    return <span>{label}</span>;
  },
}));

setUpOutpostView();

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('request cards while the chat list changes', () => {
  it('stay as they are when a chat outside the outpost changes', async () => {
    show(detail([post(1, { state: 'working' }), post(2, { state: 'sent' })]));
    client.setQueryData(queryKeys.conversations, [
      chat(FE_CHAT, { title: 'Usage page' }),
      chat(API_CHAT, { title: 'Usage endpoint' }),
      chat(DOCS_CHAT, { title: 'Docs' }),
    ]);
    localStorage.setItem('spark-outpost.outpost-overview', 'hidden');
    view();
    const first = rendered.pills;
    expect(first).toBeGreaterThan(0);

    await act(async () => {
      client.setQueryData(queryKeys.conversations, [
        chat(FE_CHAT, { title: 'Usage page' }),
        chat(API_CHAT, { title: 'Usage endpoint' }),
        chat(DOCS_CHAT, { title: 'Docs, renamed', updatedAt: '2026-10-09T11:00:00.000Z' }),
      ]);
      await flush();
    });

    expect(rendered.pills).toBe(first);
  });

  it('draw again when the request they show changes', async () => {
    show(detail([post(1, { state: 'working' })]));
    localStorage.setItem('spark-outpost.outpost-overview', 'hidden');
    view();
    const first = rendered.pills;

    await act(async () => {
      show(detail([post(1, { state: 'sent' })]));
      await flush();
    });

    expect(rendered.pills).toBeGreaterThan(first);
  });
});
