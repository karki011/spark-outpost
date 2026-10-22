import { describe, expect, it } from 'vitest';
import { createUpdateMapper } from './session-updates.ts';

const CHAT = '11111111-1111-4111-8111-111111111111';
const PAGE = '22222222-2222-4222-8222-222222222222';
const link = (uri: string) => ({ type: 'resource_link' as const, uri, name: 'Dashboard' });

describe('a resource link to a Spark artifact', () => {
  it('becomes an artifact link from a tool result, carrying only the ids', () => {
    const mapper = createUpdateMapper();
    mapper.map({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'spark_artifact' });
    const outputs = mapper.map({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      content: [{ type: 'content', content: link(`ui://spark/${CHAT}/${PAGE}`) }],
    });
    expect(outputs).toContainEqual({
      kind: 'artifact_link',
      conversationId: CHAT,
      artifactId: PAGE,
    });
  });

  it('becomes an artifact link from the agent’s own message, with no text', () => {
    const outputs = createUpdateMapper().map({
      sessionUpdate: 'agent_message_chunk',
      content: link(`ui://spark/${CHAT}/${PAGE}`),
    });
    expect(outputs).toEqual([{ kind: 'artifact_link', conversationId: CHAT, artifactId: PAGE }]);
  });

  it('ignores other ui:// links and web links', () => {
    const mapper = createUpdateMapper();
    const other = mapper.map({
      sessionUpdate: 'agent_message_chunk',
      content: link(`ui://weather/${CHAT}/${PAGE}`),
    });
    const web = mapper.map({
      sessionUpdate: 'agent_message_chunk',
      content: link('https://example.com/page'),
    });
    expect(other.some((output) => output.kind === 'artifact_link')).toBe(false);
    expect(web.some((output) => output.kind === 'artifact_link')).toBe(false);
  });
});
