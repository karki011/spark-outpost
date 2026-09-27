import type { IntakeQuestions, SystemOneResponse } from '../advisor/intake-questions.ts';
import { noulVerdict, type NoulVerdict } from './parallel-choice.ts';
import { laneChanges, sensitiveFiles, type LaneOptions } from './placement.ts';

export const ONE_BUILDER_QUESTION =
  'One Builder doing these chains one after another would be as good as parallel Builders';
export const SAME_FOLDER_QUESTION =
  'These Builders can work in the same folder at the same time without conflicting';

export interface LaneVerdicts {
  oneBuilder: NoulVerdict | null;
  sameFolder: NoulVerdict | null;
}

export function laneQuestions(
  steps: readonly string[],
  lanes: readonly (readonly number[])[],
): Pick<IntakeQuestions, 'questions'> & { chains: Record<string, unknown> } {
  const chains = Object.fromEntries(
    lanes.map((lane, index) => [
      String.fromCharCode(65 + index),
      {
        steps: lane.map((step) => step + 1),
        changes: laneChanges(steps, lane),
        sensitive: sensitiveFiles(steps, [lane]).map((entry) => `${entry.file} (${entry.kind})`),
      },
    ]),
  );
  const sensitive = sensitiveFiles(steps, lanes).length > 0;
  return {
    chains,
    questions: {
      one_builder: {
        type: 'noul',
        instructions: `${ONE_BUILDER_QUESTION}: \`chains\` of \`task\`. Each extra Builder starts cold and has to read the code again, so parallel Builders only pay off when every chain is long.`,
        criteria: {
          yes: 'The chains are short; one Builder in sequence would finish about as soon for less',
          no: 'Each chain is long enough that parallel Builders finish clearly sooner',
        },
      },
      ...(sensitive ? { same_folder: sameFolderQuestion() } : {}),
    },
  };
}

function sameFolderQuestion(): Record<string, unknown> {
  return {
    type: 'noul',
    instructions: `${SAME_FOLDER_QUESTION}: \`chains\` of \`task\`, each with the files it changes and any manifests, lockfiles or generated files among them. Sharing the folder is unsafe when one chain installs packages, regenerates files, reformats the whole project, or changes files the other reads.`,
    criteria: {
      yes: 'The chains change separate files and nothing they run touches the other’s files',
      no: 'They could step on each other: shared manifests, installs, generated files or overlapping edits',
    },
  };
}

function verdict(response: SystemOneResponse | null, key: string): NoulVerdict | null {
  const answer = response?.answers[key];
  return answer?.type === 'noul' ? noulVerdict(answer.noul) : null;
}

export function parseLaneAnswers(response: SystemOneResponse | null): LaneVerdicts {
  return {
    oneBuilder: verdict(response, 'one_builder'),
    sameFolder: verdict(response, 'same_folder'),
  };
}

export interface SplitDecision {
  lanes: number[][];
  rule: number[][];
  jev: NoulVerdict | null;
  architect: boolean | null;
  source: 'jev' | 'architect' | 'rules' | 'forced';
}

const copy = (lanes: readonly number[][]) => lanes.map((lane) => [...lane]);

export function chooseSplit(
  anyLanes: readonly number[][],
  ruleLanes: readonly number[][],
  oneBuilder: NoulVerdict | null,
  option: LaneOptions['split'] = 'jev',
  architect: boolean | null = null,
): SplitDecision {
  const base = { rule: copy(ruleLanes), jev: oneBuilder, architect };
  if (option === 'any') return { ...base, lanes: copy(anyLanes), source: 'forced' };
  if (option === 'large') return { ...base, lanes: base.rule, source: 'rules' };
  const jevValue = oneBuilder?.value ?? null;
  if (jevValue === true) return { ...base, lanes: [], source: 'jev' };
  if (jevValue === false) return { ...base, lanes: copy(anyLanes), source: 'jev' };
  if (architect === true) return { ...base, lanes: copy(anyLanes), source: 'architect' };
  if (architect === false) return { ...base, lanes: [], source: 'architect' };
  return { ...base, lanes: base.rule, source: 'rules' };
}
