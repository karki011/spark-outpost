import { describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { EVERYTHING_AVAILABLE } from '../availability.ts';
import { sparkToolsFor } from '../server.ts';
import { ASK_SPARK_REFUSALS, cardRefusal } from './ask-spark-limits.ts';

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
    expect(cardRefusal(card(), 'other', 'assistant')).toBeNull();
  });

  it('keeps hold-to-confirm, instruction, Mac and sign-in cards with the user', () => {
    const payload = card().payload;
    expect(cardRefusal(card({ payload: { ...payload, forcePush: ['main'] } }), 'c', 'a')).toBe(
      ASK_SPARK_REFUSALS.held,
    );
    expect(
      cardRefusal(card({ payload: { ...payload, instructionFiles: ['CLAUDE.md'] } }), 'c', 'a'),
    ).toBe(ASK_SPARK_REFUSALS.instructions);
    const mac = { action: 'calendar_read', what: 'today' };
    expect(
      cardRefusal(card({ payload: { ...payload, sparkAction: mac } as never }), 'c', 'a'),
    ).toBe(ASK_SPARK_REFUSALS.macOnly);
  });

  it('refuses its own cards, answered cards and cards without Allow once and Deny', () => {
    expect(cardRefusal(card(), 'assistant', 'assistant')).toBe(ASK_SPARK_REFUSALS.ownCard);
    expect(cardRefusal(card({ status: 'allowed' }), 'c', 'a')).toBe(ASK_SPARK_REFUSALS.notWaiting);
    expect(cardRefusal(null, null, 'a')).toBe(ASK_SPARK_REFUSALS.notWaiting);
    const onlyAllow = card({ options: [{ optionId: 'a', name: 'Allow', kind: 'allow_once' }] });
    expect(cardRefusal(onlyAllow, 'c', 'a')).toBe(ASK_SPARK_REFUSALS.noOption);
  });
});

describe('the tools Ask Spark is offered', () => {
  const names = (scope: { readOnly?: boolean; assistant?: boolean }) =>
    sparkToolsFor(scope, EVERYTHING_AVAILABLE).map((tool) => tool.name);

  it('gives Ask Spark its own actions and the ticket comment and move, nothing else that acts', () => {
    const offered = names({ readOnly: true, assistant: true });
    expect(offered).toEqual(
      expect.arrayContaining([
        'spark_start_chat',
        'spark_send_to_chat',
        'spark_stop_chat',
        'spark_archive_chat',
        'spark_answer_card',
        'spark_pause',
        'spark_start_ticket',
        'spark_comment_ticket',
        'spark_transition_ticket',
      ]),
    );
    for (const other of [
      'spark_slack_post',
      'spark_create_ticket',
      'spark_push',
      'spark_mac_act',
    ]) {
      expect(offered).not.toContain(other);
    }
  });

  it('never gives a chat or a read-only session the Ask Spark actions', () => {
    for (const scope of [{}, { readOnly: true }]) {
      expect(names(scope)).not.toContain('spark_start_chat');
      expect(names(scope)).not.toContain('spark_answer_card');
    }
  });
});
