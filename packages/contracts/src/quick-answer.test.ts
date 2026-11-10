import { describe, expect, it } from 'vitest';
import { quickAnswerOf, type QuickAnswerInput } from './quick-answer.ts';

const OPTIONS = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'always', name: 'Always', kind: 'allow_always' },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
];

function card(overrides: Partial<QuickAnswerInput> = {}): QuickAnswerInput {
  return {
    kind: 'execute',
    payloadKeys: ['command', 'cwd', 'paths', 'truncated'],
    command: 'pnpm test',
    paths: [],
    fullPaths: undefined,
    truncated: false,
    diffCount: 0,
    options: OPTIONS,
    payloadHash: 'sha256:abc',
    ...overrides,
  };
}

describe('quick answer', () => {
  it('answers an ordinary command card with allow once and deny, never always', () => {
    expect(quickAnswerOf(card())).toEqual({
      allow: 'allow',
      deny: 'deny',
      payloadHash: 'sha256:abc',
    });
  });

  it('answers an ordinary change of files that carries no before and after', () => {
    expect(quickAnswerOf(card({ kind: 'edit', command: null, paths: ['src/app.ts'] }))?.allow).toBe(
      'allow',
    );
  });

  it.each([
    ['force push', ['command', 'forcePush']],
    ['git hooks or config', ['command', 'gitControl']],
    ['secret-file send', ['command', 'secretSend']],
    ['instruction file', ['paths', 'instructionFiles']],
    ['open address', ['openAddress']],
    ['Mac control, calendar, rules or sign-in', ['command', 'sparkAction']],
    ['rules refusal', ['command', 'sparkRule']],
    ['editable fields', ['command', 'form']],
    ['question', ['checkpoint']],
    ['plan', ['plan']],
    ['send note', ['command', 'sendsTo']],
    ['reason to ask', ['command', 'asksBecause']],
  ])('keeps the %s card in the chat', (_name, payloadKeys) => {
    expect(quickAnswerOf(card({ payloadKeys }))).toBeNull();
  });

  it('keeps every other card kind in the chat', () => {
    for (const kind of ['spark_action', 'clarify', 'plan', 'accept', 'stuck'] as const) {
      expect(quickAnswerOf(card({ kind }))).toBeNull();
    }
  });

  it('keeps a card with a before and after, or a cut-off command, in the chat', () => {
    expect(quickAnswerOf(card({ diffCount: 1 }))).toBeNull();
    expect(quickAnswerOf(card({ truncated: true }))).toBeNull();
  });

  it('keeps a secret file in the chat', () => {
    const edit = { kind: 'edit', command: null } as const;
    expect(quickAnswerOf(card({ ...edit, paths: ['app/.env'] }))).toBeNull();
    expect(
      quickAnswerOf(card({ ...edit, paths: ['a.ts'], fullPaths: ['/x/.env.local'] })),
    ).toBeNull();
  });

  it('needs something to show: a command or a file', () => {
    expect(quickAnswerOf(card({ command: ' ', paths: [] }))).toBeNull();
  });

  it('needs plain allow once and deny answers that are available', () => {
    expect(quickAnswerOf(card({ options: [OPTIONS[0]!] }))).toBeNull();
    expect(
      quickAnswerOf(
        card({
          options: [{ ...OPTIONS[0]!, unavailableReason: 'Not here' }, OPTIONS[2]!],
        }),
      ),
    ).toBeNull();
    expect(quickAnswerOf(card({ options: 'nope' }))).toBeNull();
    expect(quickAnswerOf(card({ payloadHash: null }))).toBeNull();
  });
});
