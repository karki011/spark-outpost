import { agentRoleLabel, type AgentRole } from '@spark-outpost/contracts';
import type { IntakeQuestions, SystemOneResponse } from '../advisor/intake-questions.ts';
import { noulQuestion, type NoulQuestion } from '../advisor/questions.ts';
import { forJev, STEP_CHARACTERS } from './jev-questions.ts';
import {
  WATCH_REASONS,
  type ToolCall,
  type WatchAnswers,
  type WatchReason,
  type WatchTrigger,
} from './watchdog-rules.ts';

export const TITLE_CHARACTERS = 160;
export const WATCHED_STEPS = 3;

export interface WatchFacts {
  role: AgentRole;
  steps: readonly string[];
  ticked: number;
  recent: readonly ToolCall[];
  flags: readonly string[];
  trigger: WatchTrigger;
}

const ROLE_WORK: Record<AgentRole, string> = {
  scout: 'Read the code and answer a question; change nothing',
  architect: 'Read the code and write a plan; change nothing',
  builder: 'Make the change it was given',
  critic: 'Review a change and list findings; change nothing',
};

function progressLine(facts: WatchFacts): string | null {
  if (facts.role !== 'builder' || facts.steps.length < 2) return null;
  if (facts.ticked === 0) return 'no step marked done yet';
  if (facts.ticked >= facts.steps.length) return 'every step marked done';
  return 'some steps marked done, others still open';
}

function toolLine(call: ToolCall): string {
  const title = forJev(call.title).slice(0, TITLE_CHARACTERS);
  return call.kind ? `${call.kind}: ${title}` : title;
}

const QUESTIONS: Record<WatchReason, NoulQuestion> = {
  repeating: noulQuestion(
    'Is the agent repeating the same actions in `recent` without making progress on `work`?',
    {
      true: 'The same reads, commands or edits come back again and again with nothing new learned or changed in between',
      false:
        'Each action builds on the last: new files, new commands, or edits that move the work forward',
    },
  ),
  off_step: noulQuestion(
    'Are the actions in `recent` about something other than `work`, the part it was given?',
    {
      true: 'The agent is reading, running or changing things that `work` does not need',
      false: 'The actions serve `work`, including reading the code around it',
    },
  ),
  waiting: noulQuestion(
    'Do the actions in `recent` suggest the agent is waiting on something it cannot get, such as a missing tool, permission, install, service or input from the user?',
    {
      true: 'It keeps retrying a blocked action, polling, or checking for something that is not there',
      false: 'It has what it needs and is doing the work',
    },
  ),
  finished: noulQuestion(
    'Does `recent` suggest the agent has already finished `work` but keeps going instead of stopping?',
    {
      true: 'The work looks done and the agent keeps re-reading, re-running passing checks or polishing',
      false: 'The work is still under way, or the agent is wrapping up',
    },
  ),
};

export function buildWatchdogQuestions(facts: WatchFacts): IntakeQuestions {
  const work = facts.steps
    .slice(0, WATCHED_STEPS)
    .map((step) => forJev(step).slice(0, STEP_CHARACTERS));
  return {
    state: {
      role: agentRoleLabel(facts.role),
      work: work.length > 0 ? work : [ROLE_WORK[facts.role]],
      progress: progressLine(facts),
      recent: facts.recent.map(toolLine),
      flags: [...facts.flags],
      trigger: facts.trigger === 'silence' ? 'long silence' : 'every ten tool calls',
    },
    questions: { ...QUESTIONS },
  };
}

export function parseWatchdog(response: SystemOneResponse): WatchAnswers | null {
  const nouls: Partial<Record<WatchReason, number>> = {};
  let worst: WatchAnswers['worst'] = null;
  for (const reason of WATCH_REASONS) {
    const answer = response.answers[reason];
    if (answer?.type !== 'noul') continue;
    nouls[reason] = answer.noul;
    if (!worst || answer.noul > worst.noul) worst = { reason, noul: answer.noul };
  }
  return worst ? { nouls, worst } : null;
}
