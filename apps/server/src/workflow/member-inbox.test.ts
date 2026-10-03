import { describe, expect, it } from 'vitest';
import type { SteerRequests } from '../providers/provider.ts';
import { joinSteering, messagePrompt } from './member-inbox.ts';
import { withCrewNotes } from '../orchestration/member-prompts.ts';

describe('member inbox', () => {
  it('writes one message plainly and several as a list', () => {
    expect(messagePrompt([{ body: ' Use UTC. ' }])).toBe(
      '## Message from the user\nUse UTC.\n\nThe user sent this to you directly while you work. Act on it before anything else, then reply with what you changed.',
    );
    expect(messagePrompt([{ body: 'One' }, { body: 'Two' }])).toContain(
      '## Message from the user\n- One\n- Two\n',
    );
  });

  it('attaches one steering sender to every watch and detaches them together', () => {
    const attached: string[] = [];
    const watch = (name: string): SteerRequests => ({
      attach: () => {
        attached.push(`+${name}`);
        return () => attached.push(`-${name}`);
      },
    });
    expect(joinSteering([null, null])).toBeNull();
    const single = watch('a');
    expect(joinSteering([single, null])).toBe(single);
    const both = joinSteering([watch('a'), watch('b')])!;
    const detach = both.attach(async () => true);
    detach();
    expect(attached).toEqual(['+a', '+b', '-a', '-b']);
  });

  it('adds what the user told the crew to the request later members read', () => {
    expect(withCrewNotes('Fix the date.', [])).toBe('Fix the date.');
    expect(withCrewNotes('Fix the date.', [{ name: 'Bolt', body: 'Use\n UTC' }])).toBe(
      'Fix the date.\n\nWhile the crew worked, the user also said:\n- You → Bolt: Use UTC',
    );
  });
});
