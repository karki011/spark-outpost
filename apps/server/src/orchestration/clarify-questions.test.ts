import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, clarifyOptionId } from '@spark-outpost/contracts';
import {
  CLARIFY_BUTTONS_RULE,
  CLARIFY_NOTE,
  clarifyCard,
  clarifyPrNote,
  clarifyQuestions,
  clarifyReply,
  requestWithAnswers,
  stripClarifyBlock,
} from './clarify-questions.ts';

const block = (json: unknown) =>
  `I looked at the reports page.\n\n1. Which report?\n\n\`\`\`clarify\n${JSON.stringify(json)}\n\`\`\``;

const ONE = [{ question: 'Which report?', options: ['Spend', 'Usage'], default: 'Spend' }];
const TWO = [
  { question: 'Which report?', default: 'Spend' },
  {
    question: 'Better how: faster or clearer?',
    options: ['Faster', 'Clearer'],
    default: 'Clearer',
  },
];

describe('the clarify turn', () => {
  it('asks for 1 to 3 questions with defaults in a machine block', () => {
    expect(CLARIFY_NOTE).toContain('```clarify');
    expect(CLARIFY_NOTE).toContain('Do not change any files');
    expect(CLARIFY_NOTE).toContain(CLARIFY_BUTTONS_RULE);
    expect(CLARIFY_BUTTONS_RULE).toContain('"Go with my best guesses"');
    expect(CLARIFY_BUTTONS_RULE).toMatch(/Do not tell the user to press "Make the change"/);
    const labels = clarifyCard([{ question: 'Which?', default: 'A' }]).options.map(
      (option) => option.name,
    );
    for (const label of labels) expect(CLARIFY_BUTTONS_RULE).toContain(`"${label}"`);
  });

  it('reads the questions, and rejects anything malformed or empty', () => {
    expect(clarifyQuestions(block({ questions: ONE }))).toEqual(ONE);
    expect(clarifyQuestions(block({ questions: [] }))).toBeNull();
    expect(clarifyQuestions(block({ questions: [...TWO, ...TWO] }))).toBeNull();
    expect(clarifyQuestions(block({ questions: [{ question: 'Which?' }] }))).toBeNull();
    expect(clarifyQuestions('```clarify\nnot json\n```')).toBeNull();
    expect(clarifyQuestions('Which report do you mean?')).toBeNull();
    expect(clarifyQuestions(CLARIFY_NOTE)).toBeNull();
  });

  it('hides the machine block from the reply the user reads', () => {
    expect(stripClarifyBlock(block({ questions: ONE }))).toBe(
      'I looked at the reports page.\n\n1. Which report?',
    );
  });

  it('offers quick replies for a single question, and the best guesses', () => {
    const card = clarifyCard(ONE);
    expect(card).toMatchObject({ kind: 'clarify', title: 'A few questions first' });
    expect(card.payload.choices).toEqual(['Spend', 'Usage']);
    expect(card.payload.reason).toBe('Which report? (best guess: Spend)');
    expect(card.options.map((option) => option.optionId)).toEqual([
      clarifyOptionId(0),
      clarifyOptionId(1),
      CHECKPOINT_OPTION.answer,
      CHECKPOINT_OPTION.useDefaults,
      CHECKPOINT_OPTION.stop,
    ]);
    expect(card.payload.questions).toEqual([
      { question: 'Which report?', options: ['Spend', 'Usage'], default: 'Spend' },
    ]);
    expect(clarifyCard(TWO).payload.choices).toEqual([]);
    expect(clarifyCard(TWO, 'Wren').payload.agent).toBe('Wren');
  });

  it('offers the best guesses as the option to take when no answer comes', () => {
    expect(clarifyCard(TWO).payload.autoOption).toBe(CHECKPOINT_OPTION.useDefaults);
  });

  it('turns the reply into answers, falling back to the defaults', () => {
    const card = clarifyCard(ONE);
    expect(clarifyReply(card, ONE, clarifyOptionId(1), null)).toEqual({
      kind: 'choice',
      text: 'Usage',
    });
    expect(clarifyReply(card, ONE, CHECKPOINT_OPTION.answer, ' the usage one ')).toEqual({
      kind: 'own_words',
      text: 'the usage one',
    });
    expect(clarifyReply(card, ONE, CHECKPOINT_OPTION.useDefaults, null)).toEqual({
      kind: 'defaults',
      text: null,
    });
    expect(clarifyReply(card, ONE, CHECKPOINT_OPTION.stop, null)).toBeNull();
  });

  it('adds the questions and answers to the request, and to the PR body', () => {
    const answered = requestWithAnswers('Make the reports better', TWO, {
      kind: 'own_words',
      text: 'Spend, clearer labels',
    });
    expect(answered).toContain('Make the reports better');
    expect(answered).toContain('The user answered: Spend, clearer labels');
    expect(answered).toContain('- Which report? (default: Spend)');
    const guessed = requestWithAnswers('Make the reports better', TWO, {
      kind: 'defaults',
      text: null,
    });
    expect(guessed).toContain('No answer, so go with the defaults');
    expect(clarifyPrNote(TWO, { kind: 'defaults', text: null })).toBe(
      'Clarifying questions (no answer, went with the defaults):\n- Which report? → Spend\n- Better how: faster or clearer? → Clearer',
    );
  });
});
