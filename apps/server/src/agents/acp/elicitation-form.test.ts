import type * as acp from '@agentclientprotocol/sdk/unstable';
import {
  applyAskElicitationResponse,
  askUserQuestionsToCreateRequest,
} from '@agentclientprotocol/claude-agent-acp/dist/elicitation.js';
import { formContent, formQuestions } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import {
  CHECKS_QUESTION as checksQuestion,
  STORE_QUESTION as storeQuestion,
} from '../../../test/fake-acp-questions.ts';
import { agentForm, SECRET_REFUSAL } from './elicitation-form.ts';

type Questions = (typeof storeQuestion)[];

function claudeRequest(questions: Questions): acp.CreateElicitationRequest {
  return askUserQuestionsToCreateRequest(questions, 'session-1', 'toolu_1');
}

function claudeAnswers(questions: Questions, content: Record<string, unknown>) {
  const reply = { action: 'accept' as const, content: content as Record<string, string> };
  return applyAskElicitationResponse(reply, { questions }, questions);
}

function answered(
  request: acp.CreateElicitationRequest,
  answers: { picks: string[]; text: string }[],
) {
  const result = formContent(agentForm(request), answers);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const codexRequest: acp.CreateElicitationRequest = {
  sessionId: 'thread-1',
  toolCallId: 'item-1',
  mode: 'form',
  message: 'Codex needs your input to continue.',
  requestedSchema: {
    type: 'object',
    properties: {
      store: {
        title: 'Which store should the cache use?',
        description: 'Store',
        type: 'string',
        oneOf: [
          { const: 'Postgres', title: 'Postgres' },
          { const: 'Redis', title: 'Redis' },
          { const: 'None of the above', title: 'None of the above' },
        ],
        _meta: { codex: { isOther: true, isSecret: false } },
      },
      store_note: {
        type: 'string',
        title: 'Additional answer or note',
        _meta: { codex: { questionId: 'store', role: 'user_note', isSecret: false } },
      },
      name: {
        title: 'What should the cache be called?',
        type: 'string',
        _meta: { codex: { isOther: false, isSecret: false } },
      },
    },
    required: ['store', 'name'],
  },
  _meta: { codex: { autoResolutionMs: null } },
};

describe('a Claude AskUserQuestion elicitation (claude-agent-acp 0.81.2)', () => {
  it('becomes one card question per question, with the Other box folded in', () => {
    const form = agentForm(claudeRequest([storeQuestion, checksQuestion]));
    expect(form.message).toBe('Please answer the following questions.');
    expect(formQuestions(form)).toEqual([
      {
        question: 'Which store should the cache use?',
        options: ['Postgres', 'Redis'],
        default: '',
        pick: 'one',
        freeText: true,
      },
      {
        question: 'Which checks should run before the push?',
        options: ['Lint', 'Types', 'Unit tests'],
        default: '',
        pick: 'many',
        freeText: true,
      },
    ]);
  });

  it('asks the question itself, not its header, when Claude asks one', () => {
    const form = agentForm(claudeRequest([storeQuestion]));
    expect(form.message).toBe('Which store should the cache use?');
    expect(form.fields.map((field) => [field.key, field.question])).toEqual([
      ['question_0', 'Which store should the cache use?'],
    ]);
  });

  it('answers in the shape the tool reads back', () => {
    const questions = [storeQuestion, checksQuestion];
    const content = answered(claudeRequest(questions), [
      { picks: ['Redis'], text: '' },
      { picks: ['Lint', 'Types'], text: 'e2e' },
    ]);
    expect(claudeAnswers(questions, content)).toEqual({
      action: 'answered',
      updatedInput: {
        questions,
        answers: {
          'Which store should the cache use?': 'Redis',
          'Which checks should run before the push?': 'Lint, Types, e2e',
        },
      },
    });
  });

  it('sends typed text alone as the answer to a single-select question', () => {
    const content = answered(claudeRequest([storeQuestion]), [{ picks: [], text: 'SQLite' }]);
    expect(content).toEqual({ question_0_custom: 'SQLite' });
    const reply = claudeAnswers([storeQuestion], content);
    expect(reply).toMatchObject({
      updatedInput: { answers: { 'Which store should the cache use?': 'SQLite' } },
    });
  });

  it('refuses a second pick on a single-select question and unknown picks', () => {
    const form = agentForm(claudeRequest([storeQuestion]));
    expect(formContent(form, [{ picks: ['Postgres', 'Redis'], text: '' }])).toMatchObject({
      ok: false,
    });
    expect(formContent(form, [{ picks: ['Mongo'], text: '' }])).toMatchObject({ ok: false });
  });
});

describe('a Codex request_user_input elicitation (codex-acp 1.13.1)', () => {
  it('uses the field title as the question and folds the note field into it', () => {
    const questions = formQuestions(agentForm(codexRequest));
    expect(questions).toEqual([
      {
        question: 'Which store should the cache use?',
        options: ['Postgres', 'Redis', 'None of the above'],
        default: '',
        pick: 'one',
        freeText: true,
      },
      {
        question: 'What should the cache be called?',
        options: [],
        default: '',
        pick: 'one',
        freeText: true,
      },
    ]);
  });

  it('marks None of the above when only the note is typed, so required holds', () => {
    expect(
      answered(codexRequest, [
        { picks: [], text: 'SQLite' },
        { picks: [], text: 'hot-cache' },
      ]),
    ).toEqual({ store: 'None of the above', store_note: 'SQLite', name: 'hot-cache' });
  });

  it('asks for a required answer that was left empty', () => {
    const result = formContent(agentForm(codexRequest), [
      { picks: ['Redis'], text: '' },
      { picks: [], text: '  ' },
    ]);
    expect(result).toEqual({ ok: false, error: 'Answer “What should the cache be called?”.' });
  });

  it('refuses a secret question', () => {
    const secret = structuredClone(codexRequest) as acp.CreateElicitationRequest & {
      requestedSchema: { properties: Record<string, { _meta: unknown }> };
    };
    secret.requestedSchema.properties.name!._meta = { codex: { isOther: false, isSecret: true } };
    expect(() => agentForm(secret)).toThrow(SECRET_REFUSAL);
  });
});

function form(properties: Record<string, unknown>, required: string[] = []) {
  return agentForm({
    sessionId: 's',
    mode: 'form',
    message: 'A few details',
    requestedSchema: { type: 'object', properties, required } as never,
  });
}

describe('the restricted elicitation schema', () => {
  it('maps booleans, bounded numbers and enum lists', () => {
    const asked = form(
      {
        notify: { type: 'boolean', title: 'Notify the team?', default: true },
        retries: { type: 'integer', title: 'Retries', minimum: 0, maximum: 5 },
        regions: { type: 'array', title: 'Regions', items: { type: 'string', enum: ['eu', 'us'] } },
      },
      ['retries'],
    );
    expect(formQuestions(asked).map((question) => [question.options, question.default])).toEqual([
      [['Yes', 'No'], 'Yes'],
      [[], ''],
      [['eu', 'us'], ''],
    ]);
    const content = formContent(asked, [
      { picks: [], text: '' },
      { picks: [], text: '3' },
      { picks: ['us'], text: '' },
    ]);
    expect(content).toEqual({ ok: true, value: { notify: true, retries: 3, regions: ['us'] } });
    expect(
      formContent(asked, [
        { picks: ['No'], text: '' },
        { picks: [], text: '9' },
        { picks: [], text: '' },
      ]),
    ).toEqual({ ok: false, error: '“Retries” needs 5 or less.' });
    expect(
      formContent(asked, [
        { picks: [], text: '' },
        { picks: [], text: '2.5' },
        { picks: [], text: '' },
      ]),
    ).toEqual({ ok: false, error: 'Answer “Retries” with a whole number.' });
  });

  it('refuses text where only the offered answers fit', () => {
    const asked = form({ size: { type: 'string', title: 'Size', enum: ['S', 'M'] } });
    expect(formQuestions(asked)[0]?.freeText).toBe(false);
    expect(formContent(asked, [{ picks: [], text: 'XL' }])).toMatchObject({ ok: false });
  });

  it('refuses url mode, nested objects and empty forms as invalid params', () => {
    expect(() =>
      agentForm({
        sessionId: 's',
        mode: 'url',
        message: 'Sign in',
        url: 'https://example.com',
        elicitationId: 'e1',
      }),
    ).toThrow(/form elicitations only/);
    expect(() => form({ nested: { type: 'object', title: 'Nested' } })).toThrow(/type Spark/);
    expect(() => form({})).toThrow(/asks nothing/);
  });
});
