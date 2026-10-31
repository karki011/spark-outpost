import { describe, expect, it } from 'vitest';
import { messagePrompt } from './member-inbox.ts';

describe('member inbox', () => {
  it('writes one message plainly and several as a list', () => {
    expect(messagePrompt([{ body: ' Use UTC. ' }])).toBe(
      '## Message from the user\nUse UTC.\n\nThe user sent this to you directly while you work. Act on it first, then finish what you were doing and reply with both.',
    );
    expect(messagePrompt([{ body: 'One' }, { body: 'Two' }])).toContain(
      '## Message from the user\n- One\n- Two\n',
    );
  });
});
