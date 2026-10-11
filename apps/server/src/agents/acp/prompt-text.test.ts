import { describe, expect, it } from 'vitest';
import type { ProviderTurn } from '../../providers/provider.ts';
import { promptText } from './conversation-prompt.ts';
import type { SlashPrompt } from './slash-commands.ts';

const ALSO = 'The user sent this same message to @web as well.';
const HANDOFF = 'Summary of the chat so far.';

function turn(change: Partial<ProviderTurn> = {}): ProviderTurn {
  return {
    prompt: 'Add the endpoint.',
    history: [],
    settings: { method: 'cli', model: 'sonnet', modelLabel: 'Sonnet', effort: 'medium' },
    signal: new AbortController().signal,
    ...change,
  };
}

const typed = (text: string): SlashPrompt => ({ kind: 'text', text, note: null });
const command = (text: string): SlashPrompt => ({ kind: 'command', text, note: 'Sent' });

describe('the text of a prompt', () => {
  it('puts what belongs to this turn before the message on a continued session', () => {
    const sent = turn({ preamble: HANDOFF, turnPreamble: ALSO });

    expect(promptText(sent, sent.prompt, typed(sent.prompt), true)).toBe(
      `${ALSO}\n\nAdd the endpoint.`,
    );
  });

  it('puts the session preamble first on a new session, and each part once', () => {
    const sent = turn({ preamble: HANDOFF, turnPreamble: ALSO });

    expect(promptText(sent, sent.prompt, typed(sent.prompt), false)).toBe(
      `${HANDOFF}\n\n${ALSO}\n\nAdd the endpoint.`,
    );
  });

  it('is the message alone when the turn has nothing to add', () => {
    const sent = turn({ preamble: HANDOFF });

    expect(promptText(sent, sent.prompt, typed(sent.prompt), true)).toBe('Add the endpoint.');
  });

  it('leaves a command the agent runs untouched', () => {
    const sent = turn({ prompt: '/review', preamble: HANDOFF, turnPreamble: ALSO });

    expect(promptText(sent, sent.prompt, command('/review'), true)).toBe('/review');
  });
});
