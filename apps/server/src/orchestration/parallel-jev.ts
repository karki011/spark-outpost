import { insertDecision } from '../persistence/orchestrations.ts';
import { callJev, type JevCall } from './jev-calls.ts';
import {
  agreement,
  buildParallelQuestions,
  chooseGroups,
  parseParallelAnswers,
  type ParallelChoice,
  type ParallelVerdicts,
} from './parallel-choice.ts';
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

export function parallelSummary(choice: ParallelChoice): string {
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

export async function decideParallel(
  s: Session,
  raw: readonly string[],
  hinted: readonly number[][],
  large: readonly number[],
  architectRunId: string,
): Promise<ParallelVerdicts | null> {
  const steps = raw.map((step) => step.trim()).filter(Boolean);
  if (!s.flow.worktrees || steps.length < 2) return null;
  const call = s.jev
    ? await callJev(
        s.jev,
        () => buildParallelQuestions(s.input.userRequest, steps),
        s.control.signal,
      )
    : null;
  const verdicts = verdictsOf(call, steps.length);
  const choice = chooseGroups(steps, hinted, large, verdicts);
  const byJev = choice.decided.some((group) => group.source === 'jev');
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
      summary: parallelSummary(choice),
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
      },
      state: call?.asked?.state ?? null,
      questions: call?.asked?.questions ?? null,
      answers: call?.response?.answers ?? null,
    },
  });
  return verdicts;
}
