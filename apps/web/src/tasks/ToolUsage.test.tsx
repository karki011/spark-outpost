// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActivityStep } from '@spark-outpost/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { queryKeys } from '../api/client.ts';
import { ToolUsage } from './ToolUsage.tsx';
import { skillOf, toolUsage } from './tool-usage.ts';

afterEach(cleanup);

const step = (toolName: string | undefined, ms: number, extra: Partial<ActivityStep> = {}) =>
  ({
    name: toolName ?? 'Thinking',
    done: true,
    startedAt: 1_000,
    finishedAt: 1_000 + ms,
    ...(toolName ? { toolName } : {}),
    ...extra,
  }) as ActivityStep;

function shown(activity: Record<string, ActivityStep[]>, runIds: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(queryKeys.conversation('chat-1'), { activity });
  return render(
    <QueryClientProvider client={client}>
      <ToolUsage conversationId="chat-1" runIds={runIds} />
    </QueryClientProvider>,
  );
}

const itemsOf = (name: string) =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('tool use on the Cost tab', () => {
  it('counts calls and time by tool, MCP server and skill, with no cost', () => {
    shown(
      {
        'run-1': [
          step('Bash', 4_000),
          step('Bash', 2_000),
          step('mcp__linear__get_issue', 1_500),
          step('mcp__spark__spark_jira', 3_000),
          step('Skill', 500, { target: '{"skill":"release-notes"}' }),
          step(undefined, 9_000),
          step('Read', 0, { done: false, finishedAt: undefined }),
        ],
        'run-2': [step('Bash', 60_000)],
      },
      ['run-1'],
    );
    expect(itemsOf('By MCP server')).toEqual(['Spark1 call · 3s', 'linear1 call · 1s']);
    expect(itemsOf('By skill')).toEqual(['release-notes1 call · 0s']);
    expect(itemsOf('By tool')[0]).toMatch(/2 calls · 6s$/);
    expect(itemsOf('By tool')).toHaveLength(5);
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('shows nothing when no step named its tool', () => {
    const { container } = shown({ 'run-1': [step(undefined, 1_000)] }, ['run-1']);
    expect(container.firstChild).toBeNull();
  });
});

describe('toolUsage', () => {
  it('counts sub-agent steps once each, as separate calls', () => {
    const usage = toolUsage([step('Read', 1_000), step('Read', 1_000, { subagent: true })]);
    expect(usage.tools).toEqual([{ key: 'Read', label: expect.any(String), calls: 2, ms: 2_000 }]);
  });

  it('reads the skill name from the call, and nothing from other tools', () => {
    expect(skillOf(step('Skill', 0, { target: '{"skill": "docs", "args": "x"}' }))).toBe('docs');
    expect(skillOf(step('Bash', 0, { target: '{"skill":"docs"}' }))).toBeNull();
    expect(skillOf(step('Skill', 0))).toBeNull();
  });
});
