import { describe, expect, it } from 'vitest';
import { updatePlan, updateQuestions, type ChatFacts } from '../companion/update-summary.ts';
import { areaEvidence } from '../map/label-evidence.ts';
import { labelQuestions, nameCandidates } from '../map/label-questions.ts';
import { callJev, type JevAccess } from './jev-calls.ts';
import { triageQuestions } from '../pr-follow-up/triage.ts';
import { memorySecretStore } from '../setup/secrets.ts';
import type { IntakeDeps, IntakeQuestions } from './jev-types.ts';

const API_KEY = 'sk-live9f8e7d6c5b4a3f2e1d0c9b8a';
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const LEAK = `use ${API_KEY} and ${AWS_KEY}`;

function recorder() {
  const bodies: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  const deps = {
    db: null as unknown as IntakeDeps['db'],
    secrets: memorySecretStore({ jev: 'fake-jev-key' }),
    fetch: fetcher,
    baseUrl: 'https://jev.test',
  };
  return { bodies, deps };
}

async function sent(build: () => IntakeQuestions): Promise<string> {
  const { bodies, deps } = recorder();
  const access: JevAccess = { deps, model: 'jev-latest' };
  const call = await callJev(access, build, new AbortController().signal, {
    timeoutMs: 1_000,
    pauseOnFailure: false,
  });
  expect(call.status).toBe('answered');
  expect(bodies).toHaveLength(1);
  return bodies[0]!;
}

function expectClean(body: string): void {
  expect(body).not.toContain(API_KEY);
  expect(body).not.toContain(AWS_KEY);
  expect(body).toContain('[redacted:');
}

const chat: ChatFacts = {
  title: `Fix uploads ${LEAK}`,
  state: 'running',
  phase: 'building',
  step: `Editing with ${LEAK}`,
  agent: { name: 'Bolt', role: 'Builder' },
  steps: { done: 1, total: 3 },
  files: ['a.ts'],
  checks: null,
  costUsd: null,
  waitingOn: null,
  error: null,
  quietMinutes: 1,
};

describe('what Jev is sent never holds a secret from free text', () => {
  it('pull request feedback triage', async () => {
    const item = {
      sourceKey: 'c1',
      kind: 'review_comment' as const,
      githubId: '1',
      author: 'sam',
      path: 'src/a.ts',
      line: 3,
      body: LEAK,
      url: null,
    };
    expectClean(await sent(() => triageQuestions({ repo: 'acme/shop', number: 7 }, [item])));
  });

  it('the chat update: title, step and the next-step choices', async () => {
    expectClean(await sent(() => updateQuestions(chat, updatePlan(chat))));
  });

  it('Map labels: area facts, names, file paths and file contents', async () => {
    const root = `packages/${AWS_KEY}`;
    const files = [`${root}/index.ts`, `${root}/${AWS_KEY}.ts`];
    const evidence = await areaEvidence({
      facts: [`Area ${root} in package ${API_KEY}: 2 files, 10 lines.`],
      rankedPaths: files,
      ignore: [],
      read: async () => `export const key = '${API_KEY}';\n`,
    });
    const names = nameCandidates(root, API_KEY, files);
    const area = {
      repository: `shop-${API_KEY}`,
      root,
      package: API_KEY,
      grouped_because: `package.json at ${root}`,
      used_by_areas: [root],
      uses_areas: [root],
    };
    const body = await sent(() => labelQuestions(area, evidence.text, names));
    expectClean(body);
    expect(body).not.toContain(API_KEY.replaceAll('-', ' '));
  });
});

describe('what stays as it was', () => {
  it('sends ordinary text unchanged', async () => {
    const item = {
      sourceKey: 'c1',
      kind: 'review_comment' as const,
      githubId: '1',
      author: 'sam',
      path: 'src/math.ts',
      line: 3,
      body: 'Please rename percentOf to shareOf.',
      url: null,
    };
    const body = await sent(() => triageQuestions({ repo: 'acme/shop', number: 7 }, [item]));
    expect(body).toContain('Please rename percentOf to shareOf.');
    expect(body).not.toContain('[redacted:');
    expect(JSON.parse(body)).toMatchObject({ model: 'jev-1.13.0' });
  });
});
