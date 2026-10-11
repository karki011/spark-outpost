import type { RequestState } from '@spark-outpost/contracts';

export interface WrapUpFacts {
  files: number;
  branch: string | null;
  committed: boolean | null;
  pushed: boolean | null;
  notPublished: string | null;
}

export interface WrapUpTask {
  handle: string;
  title: string;
  state: RequestState | null;
  reason: string | null;
  afterHandle: string | null;
  pullRequest: string | null;
  facts?: WrapUpFacts | null;
}

const ENDED: ReadonlySet<RequestState> = new Set(['answered', 'failed', 'cancelled']);

const NO_REQUEST = 'no request was sent';
const ASK =
  'Reply with a wrap-up for the user: what was done, what failed or was cancelled, which pull requests are open and the order to merge them. This is a report and asks for no new work.';
const RECORD =
  "What each line says about files, commits, pushes and pull requests is Spark's own record of that chat's branch as it is now: report it as it stands, whatever the chat's reply said about committing or pushing.";

function hasEnded(task: Pick<WrapUpTask, 'state'>): boolean {
  return task.state === null || ENDED.has(task.state);
}

export function storySettled(tasks: readonly Pick<WrapUpTask, 'state'>[]): boolean {
  return tasks.length > 0 && tasks.every(hasEnded);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
}

function stateWords(task: WrapUpTask): string {
  if (task.state === null) return NO_REQUEST;
  const reason = task.reason === null ? '' : oneLine(task.reason);
  return reason ? `${task.state} (${reason})` : task.state;
}

function factWords(facts: WrapUpFacts): string[] {
  const committed = facts.branch ? `committed on ${oneLine(facts.branch)}` : 'committed';
  return [
    ...(facts.files > 0 ? [`${facts.files} ${facts.files === 1 ? 'file' : 'files'} changed`] : []),
    ...(facts.committed === null ? [] : [facts.committed ? committed : 'not committed']),
    ...(facts.pushed === null ? [] : [facts.pushed ? 'pushed' : 'not pushed']),
    ...(facts.notPublished ? [oneLine(facts.notPublished)] : []),
  ];
}

function taskLine(task: WrapUpTask): string {
  const title = oneLine(task.title);
  return [
    `@${task.handle}${title ? ` (${title})` : ''}: ${stateWords(task)}`,
    ...(task.facts ? factWords(task.facts) : []),
    ...(task.pullRequest ? [`pull request ${oneLine(task.pullRequest)}`] : []),
    ...(task.afterHandle ? [`started after @${task.afterHandle}`] : []),
  ].join(' · ');
}

function opening(title: string): string {
  const name = oneLine(title);
  const story = name ? `the story "${name}"` : 'the story';
  return `Every sub-task of ${story} has ended. Spark wrote this message when the last one ended; the user did not write it.`;
}

export function wrapUpBody(title: string, tasks: readonly WrapUpTask[]): string {
  const recorded = tasks.some((task) => task.facts);
  return [opening(title), ...tasks.map(taskLine), ...(recorded ? [RECORD] : []), ASK].join('\n');
}
