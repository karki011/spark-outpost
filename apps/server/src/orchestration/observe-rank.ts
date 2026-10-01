import { byProbability, readChoice, type ChoiceIssue } from '../advisor/choice-answer.ts';
import { POLICY_VERSION, RANK_PREDICTED_FILES } from '../advisor/policy.ts';
import type { RankedFile } from '../codescan/rank.ts';
import type { ScanReport } from '../codescan/scan.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { orderedPaths, predictedFiles, RANK_KEY, rankQuestions } from '../routing/file-ranking.ts';
import { callJev, type JevCall } from './jev-calls.ts';
import type { Session } from './session.ts';

const RECORDED_PROBABILITIES = 40;

interface RankAnswer {
  call: JevCall;
  issue: ChoiceIssue | null;
  confidence: number | null;
  order: string[] | null;
  probabilities: [string, number][];
}

export interface Ranking {
  files: RankedFile[];
  predicted: string[];
  probabilities: Map<string, number>;
}

function rankAnswer(call: JevCall, offered: readonly string[]): RankAnswer {
  const empty = { call, issue: null, confidence: null, order: null, probabilities: [] };
  if (call.status !== 'answered' || !call.response) return empty;
  const answer = readChoice(call.response, RANK_KEY, offered);
  if (typeof answer === 'string') return { ...empty, issue: answer };
  return {
    call,
    issue: null,
    confidence: answer.confidence,
    order: orderedPaths(answer.probabilities, offered),
    probabilities: byProbability(answer.probabilities).slice(0, RECORDED_PROBABILITIES),
  };
}

function answerRecord(answer: RankAnswer | null) {
  if (!answer) return null;
  return {
    status: answer.call.status,
    error: answer.call.error,
    issue: answer.issue,
    latencyMs: answer.call.latencyMs,
    tokens: answer.call.usage?.inputTokens ?? null,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
  };
}

function summaryOf(predicted: readonly string[], answer: RankAnswer | null): string {
  if (!answer) return `File ranking skipped; scan order kept (${predicted[0] ?? 'no files'} first)`;
  if (!answer.order) {
    const why = answer.issue ?? answer.call.error ?? answer.call.status;
    return `Jev file ranking unavailable (${why}); scan order kept`;
  }
  const [top, probability] = answer.probabilities[0] ?? [predicted[0], 0];
  return `Jev ranked files: ${top} first (${probability.toFixed(2)})`;
}

async function record(
  s: Session,
  report: ScanReport | null,
  answer: RankAnswer | null,
  predicted: string[],
  skipped: string | null,
): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'rank',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: answer?.call.status ?? (s.jev ? 'not_asked' : 'not_connected'),
    inputTokens: answer?.call.usage?.inputTokens ?? null,
    costUsd: answer?.call.usage?.costUsd ?? null,
    policyVersion: POLICY_VERSION,
    body: {
      summary: summaryOf(predicted, answer),
      applied: 'rules',
      gate: null,
      jevError: answer?.call.error ?? null,
      jevModel: answer?.call.model ?? null,
      latencyMs: answer?.call.latencyMs ?? null,
      answer: {
        observation: true,
        skipped,
        candidates: report?.candidates.length ?? 0,
        scanOrder: (report?.candidates ?? [])
          .slice(0, RANK_PREDICTED_FILES)
          .map((file) => file.path),
        jev: answerRecord(answer),
        predicted,
      },
      state: answer?.call.asked?.state ?? null,
      questions: null,
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
    const predicted = predictedFiles(scanOrder);
    await record(s, report, null, predicted, reason);
    return {
      files: report?.candidates.slice(0, RANK_PREDICTED_FILES) ?? [],
      predicted,
      probabilities: new Map(),
    };
  }
  const call = await callJev(
    s.jev,
    () => rankQuestions(s.input.userRequest, report),
    s.control.signal,
  );
  const answer = rankAnswer(call, scanOrder);
  const predicted = predictedFiles(answer.order ?? scanOrder);
  await record(s, report, answer, predicted, null);
  const byPath = new Map(report.candidates.map((file) => [file.path, file]));
  return {
    files: predicted.map((path) => byPath.get(path)!),
    predicted,
    probabilities: new Map(answer.order ? answer.probabilities : []),
  };
}
