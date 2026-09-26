import { insertDecision } from '../persistence/orchestrations.ts';
import { callJev, type JevCall } from './jev-calls.ts';
import {
  agreement,
  buildParallelQuestions,
  chooseGroups,
  parseParallelAnswers,
  type NoulVerdict,
  type ParallelChoice,
  type ParallelVerdicts,
} from './parallel-choice.ts';
import { chooseLanes } from './chains.ts';
import type { IntakeQuestions } from '../advisor/intake-questions.ts';
import { chooseSplit, laneQuestions, parseLaneAnswers, type SplitDecision } from './lane-choice.ts';
import { choosePlacement, type PlacementDecision } from './placement.ts';
import type { Session } from './session.ts';
import { stepFiles } from './step-files.ts';
import { STEP_CHARACTERS } from './jev-questions.ts';

function stepList(group: readonly number[]): string {
  const numbers = group.map((index) => index + 1);
  return numbers.length === 2
    ? `steps ${numbers[0]} and ${numbers[1]}`
    : `steps ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

function groupsLine(groups: readonly number[][]): string {
  return groups.length === 0 ? 'none' : groups.map(stepList).join('; ');
}

function chainsLine(lanes: readonly number[][]): string {
  return lanes
    .map((lane) => (lane.length === 1 ? `step ${lane[0]! + 1}` : stepList(lane)))
    .join(' | ');
}

export function parallelSummary(choice: ParallelChoice, lanes: readonly number[][] = []): string {
  if (lanes.length > 1) {
    const { asked, agreed } = agreement(choice);
    const jev =
      asked === 0
        ? 'Jev was not sure of any pair'
        : `Jev agreed with the rules on ${agreed} of ${asked}`;
    return `Chains in parallel: ${chainsLine(lanes)} · ${jev}`;
  }
  const chosen = `Parallel: ${groupsLine(choice.groups)}`;
  const same = groupsLine(choice.groups) === groupsLine(choice.rulesGroups);
  const rules = same
    ? 'same as the rules'
    : `the rules would have run ${groupsLine(choice.rulesGroups)}`;
  const { asked, agreed } = agreement(choice);
  const jev =
    asked === 0
      ? 'Jev was not sure of any answer'
      : `Jev agreed with the rules on ${agreed} of ${asked}`;
  return `${chosen} · ${rules} · ${jev}`;
}

function verdictsOf(call: JevCall | null, count: number): ParallelVerdicts | null {
  if (call?.status !== 'answered' || !call.response) return null;
  return parseParallelAnswers(count, call.response);
}

export interface ArchitectChains {
  chains: readonly number[][];
  depends: readonly (number[] | null)[];
}

export interface ParallelDecision {
  verdicts: ParallelVerdicts | null;
  lanes: number[][];
}

function withLaneQuestions(
  asked: IntakeQuestions,
  steps: readonly string[],
  candidates: readonly number[][],
): IntakeQuestions {
  if (candidates.length < 2) return asked;
  const lanes = laneQuestions(steps, candidates);
  return {
    state: { ...asked.state, chains: lanes.chains },
    questions: { ...asked.questions, ...lanes.questions },
  };
}

function verdictText(verdict: NoulVerdict | null): string {
  return verdict ? `Jev ${verdict.noul.toFixed(2)}` : 'Jev did not answer';
}

export function laneSummary(
  split: SplitDecision,
  placement: PlacementDecision | null,
  candidates: readonly number[][],
): string | null {
  if (candidates.length < 2) return null;
  const splitRule = split.rule.length > 1 ? 'split' : 'one Builder';
  const splitText = `${split.lanes.length > 1 ? 'split' : 'one Builder'} (${split.source}; ${verdictText(split.jev)} on one Builder; rule: ${splitRule})`;
  if (!placement) return `Chains: ${splitText}`;
  const where = placement.placement === 'shared' ? 'shared tree' : 'worktrees';
  const rule = placement.rule.placement === 'shared' ? 'shared tree' : 'worktrees';
  return `Chains: ${splitText} · ${where} (${placement.reason}; ${verdictText(placement.jev)} on sharing; rule: ${rule})`;
}

export async function decideParallel(
  s: Session,
  raw: readonly string[],
  hinted: readonly number[][],
  large: readonly number[],
  architect: ArchitectChains,
  architectRunId: string,
): Promise<ParallelDecision> {
  const steps = raw.map((step) => step.trim()).filter(Boolean);
  if (!s.flow.worktrees || steps.length < 2) return { verdicts: null, lanes: [] };
  const base = { steps, chains: architect.chains, depends: architect.depends, large };
  const candidates = chooseLanes({ ...base, split: 'any' });
  const call = s.jev
    ? await callJev(
        s.jev,
        () =>
          withLaneQuestions(buildParallelQuestions(s.input.userRequest, steps), steps, candidates),
        s.control.signal,
      )
    : null;
  const answered = call?.status === 'answered' ? call.response : null;
  const verdicts = verdictsOf(call, steps.length);
  const laneVerdicts = parseLaneAnswers(answered);
  const choice = chooseGroups(steps, hinted, large, verdicts);
  const withJev = {
    ...base,
    independent: verdicts?.independent ?? [],
    sizes: verdicts?.large ?? [],
  };
  const split = chooseSplit(
    chooseLanes({ ...withJev, split: 'any' }),
    chooseLanes({ ...withJev, split: 'large' }),
    laneVerdicts.oneBuilder,
    s.deps.lanes?.split,
  );
  const lanes = split.lanes;
  const placement =
    lanes.length > 1
      ? choosePlacement(
          steps,
          lanes,
          {
            answered: answered !== null && candidates.length > 1,
            verdict: laneVerdicts.sameFolder,
          },
          s.deps.lanes?.placement,
        )
      : null;
  s.lanePlacement = placement?.placement ?? null;
  const byJev =
    choice.decided.some((group) => group.source === 'jev') ||
    split.source === 'jev' ||
    placement?.source === 'jev';
  const lanesText = laneSummary(split, placement, candidates);
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'parallel',
    childRunId: architectRunId,
    role: null,
    stepIndex: null,
    jevStatus: call?.status ?? 'not_connected',
    inputTokens: call?.usage?.inputTokens ?? null,
    costUsd: call?.usage?.costUsd ?? null,
    body: {
      summary: [parallelSummary(choice, lanes), lanesText].filter(Boolean).join(' · '),
      applied: byJev ? 'jev' : 'rules',
      gate: null,
      jevError: call?.error ?? null,
      latencyMs: call?.latencyMs ?? null,
      answer: {
        steps: steps.map((step) => ({ text: step.slice(0, STEP_CHARACTERS), ...stepFiles(step) })),
        groups: choice.decided,
        chosen: choice.groups,
        rulesGroups: choice.rulesGroups,
        pairs: choice.pairs,
        sizes: choice.sizes,
        agreement: agreement(choice),
        chains: { architect: architect.chains, depends: architect.depends, candidates, lanes },
        split,
        ...(placement ? { placement } : {}),
      },
      state: call?.asked?.state ?? null,
      questions: call?.asked?.questions ?? null,
      answers: call?.response?.answers ?? null,
    },
  });
  return { verdicts, lanes };
}
