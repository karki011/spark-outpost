import { describe, expect, it } from 'vitest';
import { finalReplyOf } from './final-reply.ts';
import type { MemberResult } from './session.ts';

function member(text: string, finalReply: string | null = null): MemberResult {
  return {
    role: 'builder',
    runId: 'run',
    label: 'Builder',
    outcome: 'succeeded',
    error: null,
    text,
    finalReply,
    toolCalls: 0,
    inPlace: false,
    name: 'Bolt',
    loop: null,
  };
}

const joined = (results: readonly MemberResult[]) =>
  results.map((result) => `\n\n${result.text}`).join('');

describe('the final reply of a whole turn', () => {
  it('is unknown when no agent marked a final message', () => {
    expect(finalReplyOf(null, [member('I looked. It is 3.')], joined)).toBeNull();
    expect(finalReplyOf({ text: 'Routing.' }, [member('It is 3.')], joined)).toBeNull();
  });

  it('is the turn’s text with each member’s final message in place of its whole text', () => {
    const results = [member('I will count.\n\n3', '3'), member('Reviewed.')];

    expect(finalReplyOf(null, results, joined)).toBe('3\n\nReviewed.');
  });

  it('starts from the final message of the agent that wrote in place', () => {
    const message = { text: 'I will look.\n\nIt is v2.', finalReply: 'It is v2.' };

    expect(finalReplyOf(message, [], () => '\n\nChecks passed.')).toBe(
      'It is v2.\n\nChecks passed.',
    );
    expect(finalReplyOf(message, [], () => '')).toBe('It is v2.');
  });

  it('keeps text already written in place when only a later member marks its final message', () => {
    const message = { text: 'Plan saved.' };

    expect(finalReplyOf(message, [member('Working.\n\nDone.', 'Done.')], joined)).toBe(
      'Plan saved.\n\nDone.',
    );
  });
});
