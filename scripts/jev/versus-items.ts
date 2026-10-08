import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IntakeRequest } from '../../apps/server/src/advisor/advice.ts';
import { buildFindingQuestions } from '../../apps/server/src/advisor/finding-questions.ts';
import { buildIntakeQuestions } from '../../apps/server/src/advisor/intake-questions.ts';
import type { SystemOneRequest } from '../../apps/server/src/advisor/jev.ts';
import { buildPolicyQuestions } from '../../apps/server/src/advisor/policy-gate.ts';
import {
  buildVerdictQuestions,
  requirementLines,
} from '../../apps/server/src/advisor/verify-questions.ts';
import { builderQuestions } from '../../apps/server/src/coordinator/builder-jev.ts';
import { midBuildQuestions } from '../../apps/server/src/coordinator/mid-build-question.ts';
import {
  pieceQuestions,
  type JevPiece,
} from '../../apps/server/src/coordinator/piece-questions.ts';
import type { Gathered } from '../../apps/server/src/pr-follow-up/gather.ts';
import { triageQuestions } from '../../apps/server/src/pr-follow-up/triage.ts';
import { BENCH_CATEGORIES } from '../bench/categories.ts';
import { TASKS } from '../bench/tasks.ts';
import { replayCandidates, replayCorpus } from '../routing/replay-corpus.ts';
import { LEDGER_TASKS } from '../verifier/cases-ledger.ts';
import { MONEY_TASKS } from '../verifier/cases-money.ts';
import { CHECK_COMMAND, prepareCase } from '../verifier/repo.ts';
import {
  BENCH_INTENT,
  LABELLED_INTAKE,
  LABELLED_MID_BUILD,
  LABELLED_TRIAGE,
} from './versus-labelled.ts';

export interface Item {
  id: string;
  use: string;
  source: string;
  request: SystemOneRequest;
  truth: Record<string, string>;
  relevant?: string[];
}

export function requestHash(request: SystemOneRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 12);
}

function intakeRequest(task: string, followUp = false, previous = ''): SystemOneRequest {
  const request: IntakeRequest = {
    task,
    mode: 'do',
    reposLinked: true,
    untrusted: [],
    candidates: replayCandidates,
    current: { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort: 'medium' },
    level: 'hands-off',
    routing: 'auto',
    firstMessage: !followUp,
    currentTask: followUp ? { previousRequest: previous, summary: '' } : null,
    fourWay: true,
  };
  return buildIntakeQuestions(request);
}

function labelledIntake(): Item[] {
  const messages = LABELLED_INTAKE.map((entry, index) => ({
    id: `intake:label:${index}`,
    use: 'intake',
    source: entry.from,
    request: intakeRequest(entry.text),
    truth: entry.truth,
  }));
  const bench = TASKS.flatMap((task) => {
    const category = BENCH_CATEGORIES[task.id];
    if (!category) return [];
    const intent = BENCH_INTENT[category];
    const truth: Record<string, string> = intent ? { intent } : {};
    if (category === 'destructive') truth.destructive = 'true';
    return [
      {
        id: `intake:bench:${task.id}`,
        use: 'intake',
        source: 'scripts/bench/categories.ts',
        request: intakeRequest(task.prompt),
        truth,
      },
    ];
  });
  return [...messages, ...bench];
}

function corpusIntake(limit: number): Item[] {
  const items = replayCorpus().filter((item) => !item.id.startsWith('bench:'));
  const step = Math.max(1, Math.floor(items.length / limit));
  return items
    .filter((_, index) => index % step === 0)
    .slice(0, limit)
    .map((item) => ({
      id: `intake:corpus:${item.id}`,
      use: 'intake',
      source: 'scripts/routing/replay-corpus.ts',
      request: intakeRequest(item.request),
      truth: {},
    }));
}

function midBuild(): Item[] {
  return LABELLED_MID_BUILD.map((entry, index) => ({
    id: `mid_build:${index}`,
    use: 'mid_build',
    source: 'apps/server/src/coordinator/mid-build-question.test.ts',
    request: midBuildQuestions(entry.message, entry.build),
    truth: { mid_build: entry.truth },
  }));
}

function feedback(body: string): Gathered {
  return {
    sourceKey: `review_comment:${body.length}`,
    kind: 'review_comment',
    githubId: '1',
    author: 'alice',
    path: 'src/a.ts',
    line: 3,
    body,
    url: null,
  };
}

function triage(): Item[] {
  return LABELLED_TRIAGE.map(([body, truth], index) => ({
    id: `pr_triage:${index}`,
    use: 'pr_triage',
    source: 'apps/server/src/pr-follow-up/triage.test.ts',
    request: triageQuestions({ repo: 'acme/app', number: 12 }, [feedback(body)]),
    truth: { item_1: truth },
  }));
}

async function verifier(): Promise<Item[]> {
  const root = await mkdtemp(join(tmpdir(), 'jev-versus-'));
  const items: Item[] = [];
  for (const task of [...MONEY_TASKS, ...LEDGER_TASKS]) {
    for (const variant of ['wrong', 'correct'] as const) {
      const prepared = await prepareCase(root, { task, variant });
      const source = `scripts/verifier (${task.id}, ${variant})`;
      const id = `${task.id}:${variant}`;
      items.push({
        id: `verify:case:${id}`,
        use: 'verify',
        source,
        request: buildVerdictQuestions({
          request: task.prompt,
          plan: [],
          requirements: requirementLines(task.prompt),
          diff: prepared.diff,
          checks: [`- \`${CHECK_COMMAND}\` passed`],
        }),
        truth: { verdict: variant === 'correct' ? 'supported' : 'unsupported' },
      });
      items.push({
        id: `finding:case:${id}`,
        use: 'finding',
        source,
        request: buildFindingQuestions({
          request: task.prompt,
          diff: prepared.diff,
          findings: [`The change does not do what the request asks here: ${task.missed}.`],
        }),
        truth: { finding_1: String(variant === 'wrong') },
      });
      const path = prepared.files[0]?.path;
      if (path) {
        items.push({
          id: `policy:case:${id}`,
          use: 'policy',
          source,
          request: buildPolicyQuestions({ request: task.prompt, path, diff: prepared.diff }),
          truth: {},
        });
      }
    }
  }
  return items;
}

interface AdviceRow {
  purpose: string;
  jev_status: string;
  body: {
    state?: unknown;
    questions?: Record<string, unknown> | string[] | null;
  };
}

interface StoredPiece {
  piece_list_id: string;
  key: string;
  title: string;
  goal: string;
  owns: string[];
  reads: string[];
  acceptance: string[];
}

interface Evidence {
  advice?: AdviceRow[];
  pieces?: StoredPiece[];
  messages?: { role: string; content: string }[];
}

const EVIDENCE_USES = new Set(['intake', 'verify', 'finding', 'parallel', 'route_shadow']);
const NO_FACTS = new Map<string, never>();

function taskPieces(keys: readonly string[]): JevPiece[] {
  const tasks = [...new Set(keys.flatMap((key) => key.match(/^T\d+/) ?? []))];
  return tasks.map((key) => ({ key, title: key, goal: '', owns: [], reads: [] }));
}

function evidenceRequests(row: AdviceRow): SystemOneRequest[] {
  const { state, questions } = row.body;
  if (!state || !questions) return [];
  if (Array.isArray(questions)) {
    const asked = builderQuestions({ request: '', pieces: taskPieces(questions), facts: NO_FACTS });
    return [{ state, questions: asked.questions }];
  }
  if (row.purpose !== 'route_shadow') return [{ state, questions }];
  const variants = state as Record<string, unknown>;
  return Object.values(variants).map((variant) => ({ state: variant, questions }));
}

function evidenceTruth(use: string, request: SystemOneRequest): Record<string, string> {
  if (use !== 'intake') return {};
  const task = (request.state as { task?: string }).task ?? '';
  return LABELLED_INTAKE.find((entry) => entry.text === task)?.truth ?? {};
}

function pieceRequests(evidence: Evidence): SystemOneRequest[] {
  const request = evidence.messages?.find((message) => message.role === 'user')?.content ?? '';
  const lists = new Map<string, JevPiece[]>();
  for (const piece of evidence.pieces ?? []) {
    const list = lists.get(piece.piece_list_id) ?? [];
    list.push({
      key: piece.key,
      title: piece.title,
      goal: piece.goal,
      owns: piece.owns,
      reads: piece.reads,
      acceptance: piece.acceptance,
    });
    lists.set(piece.piece_list_id, list);
  }
  return [...lists.values()]
    .filter((pieces) => pieces.length >= 2)
    .map((pieces) => pieceQuestions({ request, pieces, facts: NO_FACTS }));
}

export function evidenceItems(directory: string): Item[] {
  const seen = new Set<string>();
  const items: Item[] = [];
  const add = (use: string, name: string, request: SystemOneRequest) => {
    const hash = requestHash(request);
    if (seen.has(hash)) return;
    seen.add(hash);
    items.push({
      id: `${use}:evidence:${hash}`,
      use,
      source: `live-final evidence ${name}`,
      request,
      truth: evidenceTruth(use, request),
    });
  };
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(directory, name), 'utf8')) as Evidence;
    for (const row of parsed.advice ?? []) {
      if (row.jev_status !== 'answered' || !EVIDENCE_USES.has(row.purpose)) continue;
      const use = row.purpose === 'parallel' ? 'builders' : row.purpose;
      for (const request of evidenceRequests(row)) add(use, name, request);
    }
    for (const request of pieceRequests(parsed)) add('pieces', name, request);
  }
  return items;
}

export async function fixtureItems(corpus: number): Promise<Item[]> {
  return [
    ...labelledIntake(),
    ...corpusIntake(corpus),
    ...midBuild(),
    ...triage(),
    ...(await verifier()),
  ];
}
