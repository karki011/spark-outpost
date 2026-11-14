import { describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { answerChoices } from './answer-choices.ts';
import { approval } from './test-approval.ts';

const withOptions = (options: Approval['options'], change: Partial<Approval> = {}): Approval => ({
  ...approval,
  options,
  ...change,
});

const claudeOptions: Approval['options'] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
];

describe('answerChoices', () => {
  it('offers the agent’s always option and the project allowlist for a command', () => {
    const choices = answerChoices(withOptions(claudeOptions));
    expect(choices.allow?.optionId).toBe('allow');
    expect(choices.deny?.optionId).toBe('reject');
    expect(choices.always).toEqual([
      {
        label: 'Always allow',
        optionId: 'allow-always',
        scope: 'once',
        unavailableReason: undefined,
      },
      { label: 'Always allow in this project', optionId: 'allow', scope: 'project' },
    ]);
  });

  it('offers no project allow for an edit or a card that always asks', () => {
    const edit = withOptions(claudeOptions, {
      kind: 'edit',
      payload: { ...approval.payload, command: null },
    });
    expect(answerChoices(edit).always.map((choice) => choice.label)).toEqual(['Always allow']);
    const always = withOptions(claudeOptions, { reason: 'Git config always asks' });
    expect(answerChoices(always).always).toEqual([]);
  });

  it('offers this chat for an instruction file and names the allow Allow once', () => {
    const instructions = withOptions(
      [
        { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
      ],
      {
        kind: 'edit',
        reason: 'Agent instructions always ask',
        payload: { ...approval.payload, command: null, instructionFiles: ['AGENTS.md'] },
      },
    );
    const choices = answerChoices(instructions);
    expect(choices.allowLabel).toBe('Allow once');
    expect(choices.always).toEqual([
      { label: 'Allow for this chat', optionId: 'allow', scope: 'chat' },
    ]);
  });

  it('offers Allow for this session on a write outside the project', () => {
    const outside = withOptions(
      [
        { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
      ],
      {
        kind: 'edit',
        reason: 'This changes ~/notes.md, which is outside this project',
        payload: { ...approval.payload, command: null, outsideWrite: 'session-1' },
      },
    );
    const choices = answerChoices(outside);
    expect(choices.allowLabel).toBe('Allow once');
    expect(choices.always).toEqual([
      { label: 'Allow for this session', optionId: 'allow', scope: 'chat' },
    ]);
  });

  it('leaves a hold-to-confirm card with only its deny', () => {
    const held = withOptions(claudeOptions, {
      reason: 'This rewrites history',
      payload: { ...approval.payload, forcePush: ['main'] },
    });
    const choices = answerChoices(held);
    expect(choices.allow).toBeUndefined();
    expect(choices.always).toEqual([]);
    expect(choices.deny?.optionId).toBe('reject');
  });

  it('keeps a second reject beside Deny', () => {
    const choices = answerChoices(
      withOptions([
        { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
        { optionId: 'no-always', name: "No, and don't ask again", kind: 'reject_always' },
        { optionId: 'no', name: 'No', kind: 'reject_once' },
      ]),
    );
    expect(choices.deny?.optionId).toBe('no');
    expect(choices.otherRejects.map((option) => option.optionId)).toEqual(['no-always']);
  });
});
