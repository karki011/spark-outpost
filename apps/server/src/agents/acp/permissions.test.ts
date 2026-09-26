import { describe, expect, it } from 'vitest';
import { declineInConversation } from './permissions.ts';

const toolCall = { toolCallId: 't', title: 'Write notes.txt' };

describe('conversation permission policy', () => {
  it('picks the reject-once option and explains why', () => {
    const decision = declineInConversation({
      sessionId: 's',
      toolCall,
      options: [
        { optionId: 'ok', name: 'Yes', kind: 'allow_once' },
        { optionId: 'always', name: 'Always', kind: 'allow_always' },
        { optionId: 'no', name: 'No', kind: 'reject_once' },
      ],
    });
    expect(decision.response).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    expect(decision.note).toBe('Declined: Write notes.txt (this chat has no project folder)');
  });

  it('points to Do mode when a project chat is asked to change something', () => {
    const decision = declineInConversation(
      { sessionId: 's', toolCall, options: [{ optionId: 'no', name: 'No', kind: 'reject_once' }] },
      true,
    );
    expect(decision.note).toBe(
      'Declined: Write notes.txt (Ask mode only reads files; switch to Do to allow changes)',
    );
  });

  it('cancels when the agent offers no way to reject', () => {
    const decision = declineInConversation({
      sessionId: 's',
      toolCall,
      options: [{ optionId: 'ok', name: 'Yes', kind: 'allow_once' }],
    });
    expect(decision.response).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});
