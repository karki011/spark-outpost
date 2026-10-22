import { describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { EVERYTHING_AVAILABLE } from '../availability.ts';
import { CHAT_TURN_ONLY, sparkToolsFor } from '../server.ts';
import { ASK_SPARK_REFUSALS, askedToAnswer, cardRefusal, namesChat } from './ask-spark-limits.ts';

const TITLE = 'deploy';
const chat = (id: string) => ({ id, title: `Chat ${id}`, terminal: false });

const card = (overrides: Partial<Approval> = {}): Approval =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    status: 'pending',
    title: 'Run pnpm deploy',
    payload: { command: 'pnpm deploy', cwd: null, paths: [], diffs: [], truncated: false },
    options: [
      { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'always', name: 'Always in this project', kind: 'allow_always' },
      { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
    ],
    ...overrides,
  }) as Approval;

describe('cardRefusal', () => {
  it('lets Ask Spark answer a plain waiting card in another chat', () => {
    expect(cardRefusal(card(), chat('other'), 'assistant')).toBeNull();
  });

  it('keeps hold-to-confirm, instruction, Mac and sign-in cards with the user', () => {
    const payload = card().payload;
    expect(
      cardRefusal(card({ payload: { ...payload, forcePush: ['main'] } }), chat('c'), 'a'),
    ).toBe(ASK_SPARK_REFUSALS.held);
    expect(
      cardRefusal(
        card({ payload: { ...payload, instructionFiles: ['CLAUDE.md'] } }),
        chat('c'),
        'a',
      ),
    ).toBe(ASK_SPARK_REFUSALS.instructions);
    const mac = { action: 'calendar_read', what: 'today' };
    expect(
      cardRefusal(card({ payload: { ...payload, sparkAction: mac } as never }), chat('c'), 'a'),
    ).toBe(ASK_SPARK_REFUSALS.macOnly);
  });

  it('leaves an agent’s question card for the user to answer', () => {
    const form = { message: 'Which store?', fields: [] };
    expect(
      cardRefusal(card({ payload: { ...card().payload, form } as never }), chat('c'), 'a'),
    ).toBe(ASK_SPARK_REFUSALS.question);
  });

  it('refuses its own cards, answered cards and cards without Allow once and Deny', () => {
    expect(cardRefusal(card(), chat('assistant'), 'assistant')).toBe(ASK_SPARK_REFUSALS.ownCard);
    expect(cardRefusal(card({ status: 'allowed' }), chat('c'), 'a')).toBe(
      ASK_SPARK_REFUSALS.notWaiting,
    );
    expect(cardRefusal(null, null, 'a')).toBe(ASK_SPARK_REFUSALS.notWaiting);
    expect(cardRefusal(card(), { ...chat('c'), terminal: true }, 'a')).toBe(
      ASK_SPARK_REFUSALS.terminal,
    );
    const onlyAllow = card({ options: [{ optionId: 'a', name: 'Allow', kind: 'allow_once' }] });
    expect(cardRefusal(onlyAllow, chat('c'), 'a')).toBe(ASK_SPARK_REFUSALS.noOption);
  });
});

describe('the tools Ask Spark is offered', () => {
  const names = (scope: { readOnly?: boolean; assistant?: boolean }) =>
    sparkToolsFor(scope, EVERYTHING_AVAILABLE).map((tool) => tool.name);

  it('gives Ask Spark every Spark tool a chat gets, plus its own, except the chat-turn ones', () => {
    const offered = names({ readOnly: true, assistant: true });
    const chat = names({});
    for (const name of chat) {
      if (CHAT_TURN_ONLY.has(name)) expect(offered).not.toContain(name);
      else expect(offered).toContain(name);
    }
    expect(offered).toEqual(
      expect.arrayContaining([
        'spark_calendar',
        'spark_calendar_edit',
        'spark_slack_post',
        'spark_create_ticket',
        'spark_jira_edit',
        'spark_mac_act',
        'spark_browser_act',
        'spark_start_chat',
        'spark_answer_card',
        'spark_meeting',
      ]),
    );
    for (const kept of [
      'spark_push',
      'spark_pull_request',
      'spark_pr_follow_up',
      'spark_terminal_run',
    ]) {
      expect(offered).not.toContain(kept);
    }
  });

  it('never gives a chat or a read-only session the Ask Spark actions', () => {
    for (const scope of [{}, { readOnly: true }]) {
      expect(names(scope)).not.toContain('spark_start_chat');
      expect(names(scope)).not.toContain('spark_answer_card');
    }
  });
});

describe('namesChat', () => {
  it('needs the whole chat title, on word boundaries', () => {
    expect(namesChat('Approve the deploy card in Build the site', 'Build the site')).toBe(true);
    expect(namesChat('Please approve the design proposal', 'Build the site')).toBe(false);
    expect(namesChat('Approve the design proposal', 'sign')).toBe(false);
    expect(namesChat('Approve Fix', 'Fix')).toBe(false);
    expect(namesChat('Allow the card in (beta) build.', '(beta) build')).toBe(true);
  });
});

describe('askedToAnswer', () => {
  it('needs the chat named in the same sentence as the request', () => {
    expect(
      askedToAnswer('Approve the card in Build the site', 'allow_once', 'Build the site'),
    ).toBe(true);
    expect(
      askedToAnswer(
        'Approve the design proposal. Summarize Build the site.',
        'allow_once',
        'Build the site',
      ),
    ).toBe(false);
    expect(
      askedToAnswer(
        'Summarize the logs. Then approve the card in Build the site',
        'allow_once',
        'Build the site',
      ),
    ).toBe(true);
  });

  it('takes only a plain request to answer, in the direction asked', () => {
    expect(askedToAnswer('Allow the deploy card', 'allow_once', TITLE)).toBe(true);
    expect(
      askedToAnswer('Please approve it in Build the site.', 'allow_once', 'Build the site'),
    ).toBe(true);
    expect(askedToAnswer('Check the deploy chat, then deny its card', 'deny', TITLE)).toBe(true);
    expect(askedToAnswer('Allow the deploy card', 'deny', TITLE)).toBe(false);
  });

  it('never takes a question, a negation or a passing mention as a request', () => {
    expect(askedToAnswer('What does this confirm card do?', 'allow_once', TITLE)).toBe(false);
    expect(askedToAnswer('Should I approve the deploy card?', 'allow_once', TITLE)).toBe(false);
    expect(askedToAnswer('Do not approve the deploy card', 'allow_once', TITLE)).toBe(false);
    expect(askedToAnswer("Don't allow anything yet", 'allow_once', TITLE)).toBe(false);
    expect(askedToAnswer('Tell me who is allowed to deploy', 'allow_once', TITLE)).toBe(false);
    expect(askedToAnswer('Please approve nothing yet', 'allow_once', TITLE)).toBe(false);
    expect(askedToAnswer('Approve no cards today', 'allow_once', TITLE)).toBe(false);
    expect(askedToAnswer('Allow it. Is that safe? Thanks', 'allow_once', TITLE)).toBe(false);
    expect(askedToAnswer('Deny it unless the tests pass', 'deny', TITLE)).toBe(false);
    expect(askedToAnswer('Run the checks. Then approve the deploy card', 'allow_once', TITLE)).toBe(
      true,
    );
  });
});
