import { describe, expect, it } from 'vitest';
import { createWebReadWatch, WEB_SEARCH_LABEL } from './web-reads.ts';

const started = (toolCallId: string, fields: Record<string, unknown>) => ({
  sessionUpdate: 'tool_call',
  toolCallId,
  status: 'pending',
  ...fields,
});
const settled = (toolCallId: string, status = 'completed') => ({
  sessionUpdate: 'tool_call_update',
  toolCallId,
  status,
});

describe('web reads for the send flag', () => {
  it("records Claude's WebFetch by site and WebSearch once it completes", () => {
    const watch = createWebReadWatch();
    expect(
      watch.see(
        started('f1', {
          name: 'WebFetch',
          kind: 'fetch',
          rawInput: { url: 'https://docs.example.com/a?b=1', prompt: 'p' },
        }),
      ),
    ).toEqual([]);
    expect(watch.see(settled('f1'))).toEqual(['web page https://docs.example.com']);
    watch.see(
      started('s1', {
        kind: 'fetch',
        rawInput: { query: 'x' },
        _meta: { claudeCode: { toolName: 'WebSearch' } },
      }),
    );
    expect(watch.see(settled('s1'))).toEqual([WEB_SEARCH_LABEL]);
  });

  it("records Codex's web search items, a page it opened by its site", () => {
    const watch = createWebReadWatch();
    watch.see(started('c1', { kind: 'search', rawInput: { type: 'webSearch', query: 'q' } }));
    expect(watch.see(settled('c1'))).toEqual([WEB_SEARCH_LABEL]);
    watch.see(
      started('c2', {
        kind: 'search',
        rawInput: { type: 'webSearch', action: { type: 'openPage', url: 'https://a.example/x' } },
      }),
    );
    expect(watch.see(settled('c2'))).toEqual(['web page https://a.example']);
  });

  it('records nothing for failed web calls or other tools', () => {
    const watch = createWebReadWatch();
    watch.see(started('f2', { name: 'WebFetch', rawInput: { url: 'https://a.example' } }));
    expect(watch.see(settled('f2', 'failed'))).toEqual([]);
    watch.see(started('r1', { name: 'Read', kind: 'read', rawInput: { file_path: '/a' } }));
    expect(watch.see(settled('r1'))).toEqual([]);
    expect(watch.see({ sessionUpdate: 'agent_message_chunk' })).toEqual([]);
  });
});
