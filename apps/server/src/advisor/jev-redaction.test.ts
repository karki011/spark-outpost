import { describe, expect, it } from 'vitest';
import { builderQuestions } from '../coordinator/builder-jev.ts';
import { midBuildQuestions } from '../coordinator/mid-build-question.ts';
import { pieceQuestions, type PieceAsk } from '../coordinator/piece-questions.ts';
import { scanReport } from '../codescan/scan-fixtures.ts';
import { callJev, type JevAccess } from '../orchestration/jev-calls.ts';
import { triageQuestions } from '../pr-follow-up/triage.ts';
import { evidenceQuestions, previewOf } from '../routing/file-evidence.ts';
import { rankQuestions } from '../routing/file-ranking.ts';
import { routeQuestion } from '../routing/route-question.ts';
import { routeState } from '../routing/route-state.ts';
import { memorySecretStore } from '../setup/secrets.ts';
import type { IntakeRequest } from './advice.ts';
import { buildFindingQuestions } from './finding-questions.ts';
import type { IntakeQuestions } from './intake-questions.ts';
import { askJev, type IntakeDeps } from './intake-recorder.ts';
import { buildPolicyQuestions, editDiff } from './policy-gate.ts';
import { buildVerdictQuestions } from './verify-questions.ts';

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

const intake: IntakeRequest = {
  task: `Rotate the key. ${LEAK}`,
  mode: 'do',
  reposLinked: true,
  untrusted: [`notes.txt: ${LEAK}`],
  candidates: [
    {
      provider: 'claude',
      name: 'Claude',
      models: [{ id: 'sonnet', label: 'Sonnet 5', description: null }],
      efforts: [],
    },
  ],
  current: { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort: null },
  level: 'hands-off',
  routing: 'pinned',
  firstMessage: false,
  currentTask: { previousRequest: `Earlier: ${LEAK}`, summary: `Summary: ${LEAK}` },
  previousReply: `I would ${LEAK}`,
  fourWay: true,
};

const pieces: PieceAsk = {
  request: LEAK,
  pieces: [
    {
      key: 'P1',
      title: `Title ${LEAK}`,
      goal: `Goal ${LEAK}`,
      owns: ['src/a.ts'],
      reads: ['src/b.ts'],
      acceptance: [`Accept ${LEAK}`],
      dependsOn: [`After ${LEAK}`],
      checks: [`pnpm test -- ${LEAK}`],
    },
    { key: 'P2', title: 'Second', goal: 'Other', owns: ['src/c.ts'], reads: [] },
  ],
  facts: new Map(),
};

describe('what Jev is sent never holds a secret from free text', () => {
  it('intake: the message, the open task, the previous reply and attached text', async () => {
    const { bodies, deps } = recorder();
    const outcome = await askJev(deps, intake, 'jev-latest');
    expect(outcome.status).toBe('answered');
    expectClean(bodies[0]!);
    const state = (JSON.parse(bodies[0]!) as { state: Record<string, unknown> }).state;
    expect(Object.keys(state)).toEqual([
      'task',
      'mode',
      'previous_request',
      'task_summary',
      'previous_reply',
      'untrusted',
    ]);
  });

  it('a message sent during a build', async () => {
    expectClean(await sent(() => midBuildQuestions(LEAK, `Build ${LEAK}`)));
  });

  it('the Builder count and the piece questions', async () => {
    expectClean(await sent(() => builderQuestions(pieces)));
    expectClean(await sent(() => pieceQuestions(pieces)));
  });

  it('the verdict: request, agreed plan, requirements, checks and diff', async () => {
    const body = await sent(() =>
      buildVerdictQuestions({
        request: LEAK,
        plan: [`Set the key to ${API_KEY}`, `Store ${AWS_KEY} in config`],
        requirements: [`Requirement ${LEAK}`],
        diff: `+const key = '${API_KEY}';\n+const id = '${AWS_KEY}';`,
        checks: [`pnpm test printed ${LEAK}`],
      }),
    );
    expectClean(body);
    expect((JSON.parse(body) as { state: { plan: string[] } }).state.plan).toHaveLength(2);
  });

  it('review findings with the agreed plan and diff', async () => {
    expectClean(
      await sent(() =>
        buildFindingQuestions({ request: LEAK, plan: LEAK, diff: LEAK, findings: [LEAK] }),
      ),
    );
  });

  it('the observed edit policy', async () => {
    const diff = editDiff([{ path: 'src/a.ts', oldText: null, newText: LEAK }]);
    expectClean(await sent(() => buildPolicyQuestions({ request: LEAK, path: 'src/a.ts', diff })));
  });

  it('routing: request, earlier turns and the last failing check', async () => {
    const facts = {
      request: LEAK,
      priorTurns: [{ role: 'assistant' as const, content: LEAK }],
      lastFailingCheck: LEAK,
      evidence: null,
    };
    expectClean(
      await sent(() => ({ state: routeState(facts, 'text'), questions: { r: routeQuestion([]) } })),
    );
  });

  it('file ranking by index facts and by file contents', async () => {
    const report = scanReport(3);
    expectClean(await sent(() => rankQuestions(LEAK, report)));
    const preview = previewOf('src/keys.ts', `export const key = '${API_KEY}';\n`, null, report);
    expectClean(await sent(() => evidenceQuestions(LEAK, [preview!])));
  });

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
});

describe('what stays as it was', () => {
  it('sends ordinary text unchanged', async () => {
    const body = await sent(() =>
      buildVerdictQuestions({
        request: 'Add percentOf.',
        plan: ['Write percentOf in src/math.ts'],
        requirements: ['Write percentOf in src/math.ts'],
        diff: '+export const percentOf = 1;',
        checks: [],
      }),
    );
    expect(JSON.parse(body)).toMatchObject({
      model: 'jev-1.13.0',
      state: { task: 'Add percentOf.', plan: ['Write percentOf in src/math.ts'] },
    });
  });
});
