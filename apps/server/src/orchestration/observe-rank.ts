import { byProbability, readChoice, type ChoiceIssue } from '../advisor/choice-answer.ts';
import { POLICY_VERSION, RANK_DEFINED_NAMES, RANK_SHORTLIST_MAX } from '../advisor/policy.ts';
import type { RankedFile } from '../codescan/rank.ts';
import type { ScanReport } from '../codescan/scan.ts';
import { definedNames, loadScanProject } from '../codescan/scan-store.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import {
  orderedPaths,
  predictedFiles,
  shortlist,
  STAGE_ONE_KEY,
  STAGE_TWO_KEY,
  stageOneQuestions,
  stageTwoQuestions,
} from '../routing/file-ranking.ts';
import { callJev, type JevCall } from './jev-calls.ts';
import type { Session } from './session.ts';

const RECORDED_PROBABILITIES = 40;

interface StageResult {
  call: JevCall;
  issue: ChoiceIssue | null;
  confidence: number | null;
  order: string[] | null;
  probabilities: [string, number][];
}

export interface Ranking {
  files: RankedFile[];
  predicted: string[];
}

function stageResult(call: JevCall, key: string, offered: readonly string[]): StageResult {
  const empty = { call, issue: null, confidence: null, order: null, probabilities: [] };
  if (call.status !== 'answered' || !call.response) return empty;
  const answer = readChoice(call.response, key, offered);
  if (typeof answer === 'string') return { ...empty, issue: answer };
  return {
    call,
    issue: null,
    confidence: answer.confidence,
    order: orderedPaths(answer.probabilities, offered),
    probabilities: byProbability(answer.probabilities).slice(0, RECORDED_PROBABILITIES),
  };
}

function stageRecord(stage: StageResult | null) {
  if (!stage) return null;
  return {
    status: stage.call.status,
    error: stage.call.error,
    issue: stage.issue,
    latencyMs: stage.call.latencyMs,
    tokens: stage.call.usage?.inputTokens ?? null,
    confidence: stage.confidence,
    probabilities: stage.probabilities,
  };
}

async function namesFor(s: Session, paths: readonly string[]) {
  const root = s.input.projectRoots[0];
  const project = root ? await loadScanProject(s.deps.db, root) : null;
  if (!project) return new Map<string, string[]>();
  return definedNames(s.deps.db, project.id, paths, RANK_DEFINED_NAMES);
}

async function rerank(s: Session, report: ScanReport, paths: readonly string[]) {
  const byPath = new Map(report.candidates.map((file) => [file.path, file]));
  const files = paths.map((path) => byPath.get(path)!);
  const defines = await namesFor(s, paths);
  const call = await callJev(
    s.jev,
    () => stageTwoQuestions(s.input.userRequest, report, files, defines),
    s.control.signal,
  );
  return stageResult(call, STAGE_TWO_KEY, paths);
}

function sum(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === 'number');
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
}

function summaryOf(predicted: readonly string[], one: StageResult | null, moved: boolean): string {
  if (!one) return `File ranking skipped; scan order kept (${predicted[0] ?? 'no files'} first)`;
  if (!one.order)
    return `Jev file ranking unavailable (${one.issue ?? one.call.error ?? one.call.status}); scan order kept`;
  const [top, probability] = one.probabilities[0] ?? [predicted[0], 0];
  const rerank = moved ? 'the rerank moved the top file' : 'the rerank kept the top file';
  return `Jev ranked files: ${predicted[0] ?? top} first (stage 1 ${top} ${probability.toFixed(2)}); ${rerank}`;
}

async function record(
  s: Session,
  report: ScanReport | null,
  one: StageResult | null,
  two: StageResult | null,
  picked: { shortlist: string[]; predicted: string[]; reason: string | null },
): Promise<void> {
  const calls = [one?.call, two?.call].filter((call): call is JevCall => call !== undefined);
  const moved = Boolean(two?.order && one?.order && two.order[0] !== one.order[0]);
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'rank',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: one?.call.status ?? (s.jev ? 'not_asked' : 'not_connected'),
    inputTokens: sum(calls.map((call) => call.usage?.inputTokens)),
    costUsd: sum(calls.map((call) => call.usage?.costUsd)),
    policyVersion: POLICY_VERSION,
    body: {
      summary: summaryOf(picked.predicted, one, moved),
      applied: 'rules',
      gate: null,
      jevError: one?.call.error ?? null,
      jevModel: one?.call.model ?? null,
      latencyMs: sum(calls.map((call) => call.latencyMs)),
      answer: {
        observation: true,
        skipped: picked.reason,
        candidates: report?.candidates.length ?? 0,
        scanOrder: (report?.candidates ?? []).slice(0, RANK_SHORTLIST_MAX).map((file) => file.path),
        stageOne: stageRecord(one),
        shortlist: picked.shortlist,
        stageTwo: stageRecord(two),
        stageTwoOrder: two?.order ?? null,
        predicted: picked.predicted,
      },
      state: one?.call.asked?.state ?? null,
      questions: two?.call.asked?.questions ?? null,
    },
  });
}

function skipReason(s: Session, report: ScanReport | null): string | null {
  if (!report || report.candidates.length === 0) return 'no candidate files';
  if (!s.jev) return 'Jev not connected';
  if (report.candidates.length === 1) return 'one candidate file';
  return null;
}

export async function rankFiles(s: Session, report: ScanReport | null): Promise<Ranking> {
  const scanOrder = (report?.candidates ?? []).map((file) => file.path);
  const reason = skipReason(s, report);
  if (!report || reason) {
    const predicted = scanOrder.slice(0, RANK_SHORTLIST_MAX);
    await record(s, report, null, null, { shortlist: [], predicted, reason });
    return { files: report?.candidates.slice(0, RANK_SHORTLIST_MAX) ?? [], predicted };
  }
  const oneCall = await callJev(
    s.jev,
    () => stageOneQuestions(s.input.userRequest, report),
    s.control.signal,
  );
  const one = stageResult(oneCall, STAGE_ONE_KEY, scanOrder);
  const firstOrder = one.order ?? scanOrder;
  const short = one.order ? shortlist(one.order, Object.fromEntries(one.probabilities)) : [];
  const two = short.length >= 2 ? await rerank(s, report, short) : null;
  const predicted = predictedFiles(firstOrder, two?.order ?? null);
  await record(s, report, one, two, { shortlist: short, predicted, reason: null });
  const byPath = new Map(report.candidates.map((file) => [file.path, file]));
  return { files: predicted.map((path) => byPath.get(path)!), predicted };
}
