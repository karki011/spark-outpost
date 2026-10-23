import {
  storyOrder,
  type OutpostStory,
  type RequestState,
  type StackWarningKind,
  type StoryPullRequest,
  type StoryTask,
} from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';
import { STATE_LABELS, webLink } from './post-text.ts';

export type PullMark = 'open' | 'draft' | 'merged' | 'closed';

export interface PrChipView {
  label: string;
  name: string;
  mark: PullMark;
  url: string | undefined;
}

export interface StoryFill {
  label: string;
  text: string;
}

export interface StoryWarningView {
  kind: StackWarningKind;
  text: string;
  fill: StoryFill | null;
}

export interface StoryRowView {
  conversationId: string;
  handle: string;
  title: string;
  state: RequestState | null;
  stateLabel: string;
  note: string | null;
  order: string | null;
  pull: PrChipView | null;
  warnings: StoryWarningView[];
}

export interface StoryBarView {
  key: string;
  title: string;
  summary: string;
  rows: StoryRowView[];
}

const NOT_STARTED = 'Not started';
const UNTITLED = 'Untitled';

function parentOf(task: StoryTask, tasks: readonly StoryTask[]): StoryTask | null {
  return tasks.find((other) => other.conversationId === task.dependsOn) ?? null;
}

function baseName(task: StoryTask, parent: StoryTask | null): string | null {
  const base = task.pullRequest?.base ?? null;
  if (base === null) return null;
  const stacked = parent !== null && parent.branch === base && parent.pullRequest !== null;
  return stacked ? `#${parent.pullRequest?.number}` : base;
}

export function pullMark(pull: Pick<StoryPullRequest, 'state' | 'draft'>): PullMark {
  return pull.state === 'open' && pull.draft ? 'draft' : pull.state;
}

function chipOf(task: StoryTask, parent: StoryTask | null): PrChipView | null {
  const pull = task.pullRequest;
  if (pull === null) return null;
  const base = baseName(task, parent);
  const mark = pullMark(pull);
  const into = base === null ? '' : ` into ${base}`;
  return {
    label: base === null ? `#${pull.number}` : `#${pull.number} → ${base}`,
    name: `Pull request #${pull.number}${into}, ${mark}`,
    mark,
    url: webLink(pull.url),
  };
}

function orderOf(task: StoryTask): string | null {
  if (task.dependsOnHandle === null) return null;
  return task.stacked ? `on @${task.dependsOnHandle}` : `after @${task.dependsOnHandle}`;
}

function fillOf(kind: StackWarningKind, task: StoryTask, parent: StoryTask | null) {
  const label = `Update from @${task.dependsOnHandle ?? 'chat'}`;
  if (kind === 'behind_parent' && parent?.branch) {
    return {
      label,
      text: `@${task.handle} merge ${parent.branch} into your branch, fix any conflicts and run the checks.`,
    };
  }
  if (kind === 'base_merged') {
    return {
      label: 'Update from the default branch',
      text: `@${task.handle} merge the default branch into your branch, fix any conflicts, run the checks, then point your pull request at the default branch with gh pr edit --base.`,
    };
  }
  return null;
}

function rowOf(task: StoryTask, tasks: readonly StoryTask[]): StoryRowView {
  const parent = parentOf(task, tasks);
  const quiet = task.state === 'answered' || task.state === 'working';
  return {
    conversationId: task.conversationId,
    handle: task.handle,
    title: task.title,
    state: task.state,
    stateLabel: task.state === null ? NOT_STARTED : STATE_LABELS[task.state],
    note: quiet ? null : task.reason,
    order: orderOf(task),
    pull: chipOf(task, parent),
    warnings: task.warnings.map((warning) => ({
      kind: warning.kind,
      text: warning.text,
      fill: fillOf(warning.kind, task, parent),
    })),
  };
}

function summaryOf(tasks: readonly StoryTask[]): string {
  const answered = tasks.filter((task) => task.state === 'answered').length;
  const pulls = tasks.filter((task) => task.pullRequest !== null).length;
  const warnings = tasks.reduce((count, task) => count + task.warnings.length, 0);
  return [
    `${answered} of ${tasks.length} answered`,
    pulls > 0 ? countLabel(pulls, 'PR') : null,
    warnings > 0 ? countLabel(warnings, 'warning') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function storyBarView(story: OutpostStory, index: number): StoryBarView {
  const tasks = storyOrder(story.tasks);
  return {
    key: story.draftId ?? `story-${index}`,
    title: story.title ?? UNTITLED,
    summary: summaryOf(tasks),
    rows: tasks.map((task) => rowOf(task, tasks)),
  };
}
