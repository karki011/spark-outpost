// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval, SparkResult } from '@spark-outpost/contracts';
import { useLinkedRepoRefresh } from './use-linked-repo-refresh.ts';

afterEach(cleanup);

function linkCard(state: SparkResult['state']): Approval {
  return {
    id: '00000000-0000-4000-8000-0000000000d2',
    runId: '00000000-0000-4000-8000-000000000001',
    toolCallId: 'spark:link_repo:1',
    kind: 'spark_action',
    title: 'Link feature-identity to this chat?',
    payloadHash: 'sha256:abc',
    options: [],
    status: state === 'waiting' ? 'pending' : 'allowed',
    reason: null,
    decisionOptionId: null,
    scope: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-11-06T10:01:00.000Z',
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      sparkAction: {
        action: 'link_repo',
        repo: 'feature-identity',
        path: '/Users/me/code/feature-identity',
        displayPath: '~/code/feature-identity',
        origin: null,
        projectId: null,
      },
      sparkResult: { state, message: null, url: null },
    },
  };
}

function rendered(initial: Approval) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ approval }) => useLinkedRepoRefresh(approval), {
    wrapper,
    initialProps: { approval: initial },
  });
  return { hook, invalidate };
}

describe('refreshing the chat after a repo is linked', () => {
  it('refetches the chat and projects once when the link card finishes', () => {
    const { hook, invalidate } = rendered(linkCard('waiting'));
    expect(invalidate).not.toHaveBeenCalled();
    hook.rerender({ approval: linkCard('done') });
    hook.rerender({ approval: linkCard('done') });
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['projects'],
      ['conversations'],
    ]);
  });

  it('leaves an old finished card alone', () => {
    const { invalidate } = rendered(linkCard('done'));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
