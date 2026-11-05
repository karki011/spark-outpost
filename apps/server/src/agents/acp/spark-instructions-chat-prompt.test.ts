import { describe, expect, it } from 'vitest';
import type { SparkSessionPrefs } from '@spark-outpost/contracts';
import { TEAMMATE_BRIEF_HEADER, sparkInstructions } from './spark-instructions.ts';

const PREFS: SparkSessionPrefs = {
  displayName: 'Sam',
  personality: 'friendly',
  agentInstructions: 'Prefer small commits.',
};

const CHAT_PROMPT =
  'You are working for the user in Spark Outpost.\n\nFrom the user’s settings:\nPrefer small commits.';

describe('sparkInstructions with a chat prompt', () => {
  it('puts the chat prompt after the Working with the user block, in full', () => {
    const long = `${CHAT_PROMPT}\n${'x'.repeat(2000)}`;

    const text = sparkInstructions({ ...PREFS, chatPrompt: long }, true, true);

    expect(text.indexOf('# Working with the user')).toBe(0);
    expect(text.endsWith(long)).toBe(true);
  });

  it('leaves the custom instructions to the chat prompt, which already carries them', () => {
    const text = sparkInstructions({ ...PREFS, chatPrompt: CHAT_PROMPT }, true);

    expect(text).not.toContain('# Custom instructions from the user');
    expect(text.split('Prefer small commits.')).toHaveLength(2);
  });

  it('keeps a teammate’s standing instructions after the chat prompt', () => {
    const teammate = { name: 'Pip', role: 'Reviewer', instructions: 'Name the file.' };

    const text = sparkInstructions({ ...PREFS, chatPrompt: CHAT_PROMPT, teammate }, true);

    expect(text.indexOf(CHAT_PROMPT)).toBeLessThan(text.indexOf(TEAMMATE_BRIEF_HEADER));
    expect(text).toContain('Name the file.');
  });

  it('changes nothing without a chat prompt', () => {
    const text = sparkInstructions({ ...PREFS, chatPrompt: null }, true);

    expect(text).toBe(sparkInstructions(PREFS, true));
    expect(text).toContain('# Custom instructions from the user\nPrefer small commits.');
  });
});
