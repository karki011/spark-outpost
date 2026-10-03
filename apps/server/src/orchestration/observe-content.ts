import { basename } from 'node:path';
import type { JevStatus } from '@spark-outpost/contracts';
import { byProbability } from '../advisor/choice-answer.ts';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import { breakerFor, JEV_PAUSED } from '../advisor/jev-breaker.ts';
import { requestModel } from '../advisor/jev.ts';
import type { ScanReport } from '../codescan/scan.ts';
import { declarationsIn } from '../codescan/scan-store.ts';
import { readSource } from '../find/excerpts.ts';
import { answerCacheKey, cachedAnswers, storeAnswers } from '../map/answer-cache.ts';
import { sendable } from '../map/label-evidence.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { readIgnore } from '../projects/project-fs.ts';
import {
  CONTENT_RANK,
  evidenceBatches,
  evidenceKey,
  evidenceQuestions,
  previewOf,
  readEvidence,
  type EvidenceBatch,
  type FilePreview,
} from '../routing/file-evidence.ts';
import { orderedPaths, predictedFiles } from '../routing/file-ranking.ts';
import { callJev, type JevAccess } from './jev-calls.ts';
import type { Ranking } from './observe-rank.ts';
import { DIFFS_OFF } from './observe.ts';
import type { Session } from './session.ts';

type ContentSession = Pick<
  Session,
  'deps' | 'lease' | 'jev' | 'jevDiffs' | 'scanRoot' | 'input' | 'control'
>;

interface BatchResult {
  files: string[];
  bytes: number;
  status: JevStatus;
  sent: boolean;
  tokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  error: string | null;
  model: string | null;
  nouls: Map<string, number> | null;
}

interface Remembered {
  nouls: Map<string, number>;
  model: string | null;
}

interface Asked {
  batches: EvidenceBatch[];
  results: BatchResult[];
  remembered: Remembered;
  dropped: string[];
  buildMs: number;
  totalMs: number;
}

type CacheKeys = ReadonlyMap<string, string>;

const IGNORE_FILE = '.sparkignore';
const NO_TIME = 'No time left before the ranking deadline.';
const INVALID = 'Jev left a file unanswered.';

function skipReason(s: ContentSession, report: ScanReport | null): string | null {
  if (!report || report.candidates.length === 0 || !s.scanRoot) return 'no candidate files';
  if (!s.jev) return 'Jev not connected';
  if (!s.jevDiffs) return DIFFS_OFF;
  if (report.candidates.length === 1) return 'one candidate file';
  if (breakerFor(s.jev.deps.fetch, s.jev.deps.baseUrl).paused) return JEV_PAUSED;
  return null;
}

async function buildPreviews(
  s: ContentSession,
  root: string,
  report: ScanReport,
): Promise<FilePreview[]> {
  const ignore = await readIgnore(root);
  const paths = report.candidates
    .map((file) => file.path)
    .filter((path) => sendable(path, ignore) && basename(path) !== IGNORE_FILE)
    .slice(0, CONTENT_RANK.files);
  const declared = await declarationsIn(s.deps.db, root, paths);
  const previews: FilePreview[] = [];
  for (const path of paths) {
    const source = await readSource(root, path);
    const preview =
      source === null ? null : previewOf(path, source, declared.get(path) ?? null, report);
    if (preview) previews.push(preview);
  }
  return previews;
}

function cacheKeys(s: ContentSession, access: JevAccess, previews: readonly FilePreview[]) {
  const model = requestModel(access.model);
  return new Map(
    previews.map((preview) => [
      preview.path,
      answerCacheKey(CONTENT_RANK.policy, model, evidenceQuestions(s.input.userRequest, [preview])),
    ]),
  );
}

async function rememberedAnswers(
  s: ContentSession,
  previews: readonly FilePreview[],
  keys: CacheKeys,
): Promise<Remembered> {
  const nouls = new Map<string, number>();
  let model: string | null = null;
  for (const preview of previews) {
    const single = evidenceQuestions(s.input.userRequest, [preview]);
    const hit = await cachedAnswers(s.deps.db, keys.get(preview.path)!, single);
    const answer = hit ? readEvidence({ paths: [preview.path] }, { ...hit }) : null;
    const noul = answer?.get(preview.path);
    if (hit && noul !== undefined) {
      nouls.set(preview.path, noul);
      model = hit.model;
    }
  }
  return { nouls, model };
}

async function rememberAnswers(
  s: ContentSession,
  batch: EvidenceBatch,
  response: SystemOneResponse,
  keys: CacheKeys,
): Promise<void> {
  for (const [index, path] of batch.paths.entries()) {
    const answer = response.answers[evidenceKey(index)];
    const key = keys.get(path);
    if (!answer || !key) continue;
    await storeAnswers(s.deps.db, key, {
      model: response.model,
      answers: { [evidenceKey(0)]: answer },
    });
  }
}

async function askBatch(
  s: ContentSession,
  access: JevAccess,
  batch: EvidenceBatch,
  keys: CacheKeys,
  deadline: number,
): Promise<BatchResult> {
  const base = { files: batch.paths, bytes: batch.bytes, sent: false, costUsd: null };
  const timeoutMs = deadline - Date.now();
  if (timeoutMs < CONTENT_RANK.minCallMs) {
    return {
      ...base,
      status: 'timed_out',
      tokens: null,
      latencyMs: null,
      error: NO_TIME,
      model: null,
      nouls: null,
    };
  }
  const call = await callJev(access, () => batch.asked, s.control.signal, {
    timeoutMs,
    pauseOnFailure: false,
  });
  const nouls = call.status === 'answered' ? readEvidence(batch, call.response) : null;
  if (call.response && nouls) await rememberAnswers(s, batch, call.response, keys);
  return {
    ...base,
    status: call.status,
    sent: call.asked !== null,
    tokens: call.usage?.inputTokens ?? null,
    costUsd: call.usage?.costUsd ?? null,
    latencyMs: call.latencyMs,
    error: call.error ?? (call.status === 'answered' && !nouls ? INVALID : null),
    model: call.model,
    nouls,
  };
}

function overallStatus(results: readonly BatchResult[]): JevStatus {
  if (results.some((result) => result.status === 'timed_out')) return 'timed_out';
  if (results.some((result) => result.status !== 'answered')) return 'failed';
  return 'answered';
}

function probabilitiesOf(asked: Asked): Record<string, number> | null {
  if (asked.results.some((result) => !result.nouls)) return null;
  return Object.fromEntries([
    ...asked.remembered.nouls,
    ...asked.results.flatMap((result) => [...result.nouls!]),
  ]);
}

function sum(values: readonly (number | null)[]): number | null {
  const known = values.filter((value) => value !== null);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
}

function summaryOf(asked: Asked, probabilities: Record<string, number> | null): string {
  if (!probabilities) {
    const why = asked.results.find((result) => result.error)?.error ?? overallStatus(asked.results);
    return `Jev file previews unavailable (${why}); current ranking kept`;
  }
  const [top, probability] = byProbability(probabilities)[0] ?? ['no files', 0];
  const files = Object.keys(probabilities).length;
  const cached = asked.remembered.nouls.size;
  const fromCache = cached > 0 ? `, ${cached} from the answer cache` : '';
  return `Jev read ${files} file previews${fromCache}: ${top} first (${probability.toFixed(2)}); observed only`;
}

function batchRecord(result: BatchResult) {
  return {
    files: result.files,
    bytes: result.bytes,
    status: result.status,
    sent: result.sent,
    tokens: result.tokens,
    latencyMs: result.latencyMs,
    error: result.error,
  };
}

async function recordSkipped(
  s: ContentSession,
  report: ScanReport | null,
  skipped: string,
): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'rank_content',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: s.jev ? 'not_asked' : 'not_connected',
    inputTokens: null,
    costUsd: null,
    policyVersion: CONTENT_RANK.policy,
    body: {
      summary: `File previews not sent (${skipped}); current ranking kept`,
      applied: 'rules',
      gate: null,
      jevError: null,
      jevModel: null,
      latencyMs: null,
      answer: {
        observation: true,
        promoted: false,
        skipped,
        candidates: report?.candidates.length ?? 0,
        sent: [],
        order: null,
      },
      state: null,
      questions: null,
    },
  });
}

async function recordAsked(
  s: ContentSession,
  report: ScanReport,
  asked: Asked,
  order: string[] | null,
  probabilities: Record<string, number> | null,
): Promise<void> {
  const results = asked.results;
  const allCached = results.length === 0;
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'rank_content',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: overallStatus(results),
    inputTokens: allCached ? 0 : sum(results.map((result) => result.tokens)),
    costUsd: allCached ? 0 : sum(results.map((result) => result.costUsd)),
    policyVersion: CONTENT_RANK.policy,
    body: {
      summary: summaryOf(asked, probabilities),
      applied: order && CONTENT_RANK.promote ? 'jev' : 'rules',
      gate: null,
      jevError: results.find((result) => result.error)?.error ?? null,
      jevModel: results.find((result) => result.model)?.model ?? asked.remembered.model,
      latencyMs: asked.totalMs,
      answer: {
        observation: !CONTENT_RANK.promote,
        promoted: CONTENT_RANK.promote && order !== null,
        skipped: null,
        candidates: report.candidates.length,
        sent: results.filter((result) => result.sent).flatMap((result) => result.files),
        cached: [...asked.remembered.nouls.keys()],
        dropped: asked.dropped,
        buildMs: asked.buildMs,
        batches: results.map(batchRecord),
        probabilities: probabilities ? byProbability(probabilities) : [],
        order: order ? predictedFiles(order) : null,
      },
      state: asked.batches.map((batch) => batch.asked.state),
      questions: null,
    },
  });
}

async function askAboutContents(
  s: ContentSession,
  access: JevAccess,
  root: string,
  report: ScanReport,
): Promise<Ranking | null> {
  const startedAt = Date.now();
  const deadline = startedAt + CONTENT_RANK.deadlineMs;
  const previews = await buildPreviews(s, root, report);
  if (previews.length < 2) {
    await recordSkipped(s, report, 'fewer than two files to read');
    return null;
  }
  const keys = cacheKeys(s, access, previews);
  const remembered = await rememberedAnswers(s, previews, keys);
  const fresh = previews.filter((preview) => !remembered.nouls.has(preview.path));
  const { batches, dropped } = evidenceBatches(s.input.userRequest, fresh);
  const buildMs = Date.now() - startedAt;
  const results = await Promise.all(
    batches.map((batch) => askBatch(s, access, batch, keys, deadline)),
  );
  const asked = { batches, results, remembered, dropped, buildMs, totalMs: Date.now() - startedAt };
  const probabilities = probabilitiesOf(asked);
  const scanOrder = report.candidates.map((file) => file.path);
  const order = probabilities ? orderedPaths(probabilities, scanOrder) : null;
  await recordAsked(s, report, asked, order, probabilities);
  if (!order || !probabilities) return null;
  const predicted = predictedFiles(order);
  const byPath = new Map(report.candidates.map((file) => [file.path, file]));
  return {
    files: predicted.map((path) => byPath.get(path)!),
    predicted,
    probabilities: new Map(Object.entries(probabilities)),
  };
}

export async function rankByContent(
  s: ContentSession,
  report: ScanReport | null,
): Promise<Ranking | null> {
  try {
    const skipped = skipReason(s, report);
    if (skipped || !report || !s.jev || !s.scanRoot) {
      await recordSkipped(s, report, skipped ?? 'no candidate files');
      return null;
    }
    return await askAboutContents(s, s.jev, s.scanRoot, report);
  } catch (error) {
    console.error('Could not rank files by their contents', error);
    return null;
  }
}

export function agentRanking(
  current: Promise<Ranking>,
  content: Promise<Ranking | null>,
  promote: boolean = CONTENT_RANK.promote,
): Promise<Ranking> {
  if (!promote) return current;
  return Promise.all([current, content]).then(([rules, read]) => read ?? rules);
}
