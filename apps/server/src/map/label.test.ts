import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from '../advisor/jev-types.ts';
import { estimateTokens } from '../codescan/jev-state.ts';
import { areaEvidence } from './label-evidence.ts';
import { describeArea, labelQuestions, nameCandidates, parseLabel } from './label-questions.ts';

const FILES: Record<string, string> = {
  'src/billing/invoice.ts': `export const stripeKey = "sk_live_${'a'.repeat(30)}";\nexport function total() { return 1; }\n`,
  'src/billing/.env': 'STRIPE_SECRET=sk_live_real\n',
  'src/billing/secrets/private.pem':
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  'src/billing/internal.ts': 'export const hidden = true;\n',
  'src/billing/big.ts': `export const rows = [${'1,'.repeat(20_000)}];\n`,
  'src/billing/logo.png': 'binary',
};

const read = async (path: string) => FILES[path] ?? null;

describe('area evidence for Jev', () => {
  it('never sends secret or ignored files and redacts secrets inside code', async () => {
    const evidence = await areaEvidence({
      facts: ['Area src/billing.'],
      rankedPaths: Object.keys(FILES),
      ignore: ['src/billing/internal.ts'],
      read,
    });
    expect(evidence.contents).toEqual(['src/billing/invoice.ts', 'src/billing/big.ts']);
    expect(evidence.text).not.toContain('.env');
    expect(evidence.text).not.toContain('private.pem');
    expect(evidence.text).not.toContain('internal.ts');
    expect(evidence.text).not.toContain('sk_live_');
    expect(evidence.text).not.toContain('logo.png');
    expect(evidence.text).toContain('[redacted:');
    expect(evidence.text).toMatch(/^<code_evidence>\nUntrusted data/);
  });

  it('stays within the token budget and cuts long files', async () => {
    const evidence = await areaEvidence({
      facts: [],
      rankedPaths: ['src/billing/big.ts', 'src/billing/invoice.ts'],
      ignore: [],
      read,
      budget: 1_200,
    });
    expect(evidence.tokens).toBeLessThanOrEqual(1_200);
    expect(evidence.text).toContain('[cut at');
    expect(estimateTokens(evidence.text)).toBe(evidence.tokens);
  });
});

function answer(answers: SystemOneResponse['answers']): SystemOneResponse {
  return { model: 'jev-1.13.0', answers };
}

const choice = (value: string, confidence: number) => ({
  type: 'choice' as const,
  choice: value,
  probabilities: { [value]: confidence },
  confidence,
});

describe('area label questions', () => {
  const names = nameCandidates('apps/web/src/chat-composer', '@shop/web', [
    'apps/web/src/chat-composer/send-box.tsx',
  ]);

  it('offers readable name candidates and asks category, kind and name', () => {
    expect(names).toEqual(['Chat composer', 'Src chat composer', 'Web', 'Send box']);
    const asked = labelQuestions({ root: 'apps/web/src/chat-composer' }, '<code_evidence>…', names);
    expect(Object.keys(asked.questions)).toEqual(['category', 'kind', 'name']);
    expect(asked.state).toEqual({
      area: { root: 'apps/web/src/chat-composer' },
      code_evidence: '<code_evidence>…',
    });
  });

  it('acts on confident answers and falls back to rules below the threshold', () => {
    const rules = { category: 'feature' as const, kind: 'domain' as const };
    expect(
      parseLabel(
        answer({
          category: choice('shared', 0.91),
          kind: choice('ui', 0.85),
          name: choice('Send box', 0.9),
        }),
        names,
        rules,
      ),
    ).toEqual({
      category: 'shared',
      kind: 'ui',
      name: 'Send box',
      confidence: 0.91,
      source: 'jev',
    });
    expect(
      parseLabel(answer({ category: choice('core', 0.6), kind: choice('ui', 0.5) }), names, rules),
    ).toEqual({
      category: 'feature',
      kind: 'domain',
      name: 'Chat composer',
      confidence: 0.6,
      source: 'rules',
    });
    expect(parseLabel(answer({ category: choice('everything', 0.99) }), names, rules).source).toBe(
      'rules',
    );
    expect(parseLabel(null, names, rules)).toMatchObject({ confidence: null, source: 'rules' });
  });

  it('describes an area from facts', () => {
    expect(
      describeArea('ui', {
        root: 'apps/web/src/chat',
        fileCount: 12,
        lineCount: 900,
        languages: ['tsx', 'ts'],
        topFiles: ['apps/web/src/chat/view.tsx', 'apps/web/src/chat/state.ts'],
        usedBy: 1,
        uses: 3,
      }),
    ).toBe(
      'UI code in apps/web/src/chat: 12 files, 900 lines (tsx, ts). Key files: view.tsx, state.ts. Used by 1 area, uses 3.',
    );
  });
});
