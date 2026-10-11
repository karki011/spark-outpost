import {
  isSecretFileName,
  isTerminalRunStatus,
  type ChangeEntry,
  type ConversationDetail,
  type ConversationSummary,
  type PlanProgress,
  type Project,
} from '@spark-outpost/contracts';
import { viewSteps, type StepView } from '../chat/run-projection.ts';
import { hideSecrets } from '../chat/status/status-text.ts';
import { STEP_VERBS, stepKind, type StepKind } from '../chat/status/step-activity.ts';
import { sessionState } from './island-model.ts';
import { firstSentence } from './plain-line.ts';

export const HOME_PAGES = 5;
export const ACTIVITY_LINES = 3;
const TARGET_CHARS = 28;

const byRecent = (a: ConversationSummary, b: ConversationSummary) =>
  b.updatedAt.localeCompare(a.updatedAt);

export function homeSessions(chats: readonly ConversationSummary[]): ConversationSummary[] {
  const open = chats.filter((chat) => !chat.archivedAt);
  const waiting = open.filter((chat) => sessionState(chat) === 'waiting').toSorted(byRecent);
  const working = open.filter((chat) => sessionState(chat) === 'working').toSorted(byRecent);
  const live = [...waiting, ...working];
  if (live.length > 0) return live.slice(0, HOME_PAGES);
  const latest = open.toSorted(byRecent)[0];
  return latest ? [latest] : [];
}

export interface StepCount {
  current: number;
  total: number;
}

export function stepCount(progress: PlanProgress | null | undefined): StepCount | null {
  if (!progress || progress.total < 2) return null;
  const current = Math.min(progress.total, progress.done + (progress.active > 0 ? 1 : 0));
  return { current, total: progress.total };
}

export interface RunActivity {
  runId: string | null;
  runIds: readonly string[];
  steps: StepView[];
}

const NO_ACTIVITY: RunActivity = { runId: null, runIds: [], steps: [] };

function memberRuns(detail: ConversationDetail, runId: string): string[] {
  const members = (detail.orchestrations?.[runId]?.crew ?? []).filter(
    (member) => member.runId !== runId,
  );
  const live = members.filter((member) => !isTerminalRunStatus(member.status)).toReversed();
  const finished = members
    .filter((member) => isTerminalRunStatus(member.status))
    .toSorted((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  return [...live, ...finished].map((member) => member.runId);
}

export function runActivity(
  chat: ConversationSummary,
  detail: ConversationDetail | undefined,
): RunActivity {
  if (!detail) return NO_ACTIVITY;
  const live = detail.runs
    .filter((run) => !isTerminalRunStatus(run.status))
    .map((run) => run.id)
    .toReversed();
  const owners = [chat.latestRun?.id, ...live].flatMap((id) => (id ? [id] : []));
  for (const owner of owners) {
    for (const runId of [...memberRuns(detail, owner), owner]) {
      const steps = detail.activity[runId];
      if (steps?.length) {
        return { runId, runIds: [...new Set([runId, owner])], steps: viewSteps(steps) };
      }
    }
  }
  return NO_ACTIVITY;
}

export function finishedLine(
  detail: ConversationDetail | undefined,
  runId: string | undefined,
): string | null {
  if (!detail || !runId) return null;
  const reply = detail.messages.find(
    (message) => message.role === 'assistant' && message.runId === runId,
  );
  const sentence = reply ? firstSentence(hideSecrets(reply.content)) : '';
  return sentence || null;
}

export type ActivityState = 'done' | 'active' | 'failed';

export interface LineChange {
  runId: string;
  path: string;
  added: number;
  removed: number;
}

export interface ActivityLine {
  key: string;
  kind: StepKind;
  verb: string;
  target: string | null;
  state: ActivityState;
  path: string | null;
  change: LineChange | null;
}

const URL_TOKEN = /^[a-z][\w+.-]*:\/\/([^/\s?#]+)/i;
const PATH_TOKEN = /[\\/]|^[\w@.-]+\.[a-z0-9]{1,8}$/i;

function clip(text: string): string {
  return text.length > TARGET_CHARS ? `${text.slice(0, TARGET_CHARS - 1).trimEnd()}…` : text;
}

function tidyToken(token: string): string {
  return token.replace(/^["'(<[]+|["')>\],;]+$/g, '').replace(/:\d*(:\d+)?$/, '');
}

function shortToken(token: string): string {
  const tidy = tidyToken(token);
  const host = tidy.match(URL_TOKEN)?.[1];
  if (host) return host;
  if (PATH_TOKEN.test(tidy)) return tidy.split(/[\\/]/).filter(Boolean).at(-1) ?? tidy;
  return tidy;
}

function commandTarget(words: string[]): string | null {
  const kept = words.filter((word) => !word.includes('=') && !word.startsWith('-')).slice(0, 2);
  return kept.length > 0 ? clip(kept.map(shortToken).join(' ')) : null;
}

function pathWord(words: string[]): string | null {
  return words.find((word) => PATH_TOKEN.test(tidyToken(word)) || URL_TOKEN.test(word)) ?? null;
}

function plainTarget(words: string[]): string | null {
  const path = pathWord(words);
  if (path) return clip(shortToken(path));
  const text = words.map(shortToken).join(' ').trim();
  return text ? clip(text) : null;
}

function filePath(kind: StepKind, words: string[]): string | null {
  if (kind !== 'read' && kind !== 'edit') return null;
  const word = pathWord(words);
  if (!word || URL_TOKEN.test(word)) return null;
  return tidyToken(word).replace(/\\/g, '/');
}

export function activityLine(step: StepView, index: number, live: boolean): ActivityLine {
  const state: ActivityState =
    step.status === 'failed' ? 'failed' : step.status === 'open' && live ? 'active' : 'done';
  const safe = hideSecrets(step.name);
  const command = safe.trim().startsWith('`');
  const words = safe.replace(/`/g, ' ').split(/\s+/).filter(Boolean);
  const kind = command ? 'run' : stepKind(words[0]);
  const key = `${index}`;
  if (kind === 'other') {
    const verb = clip(words.map(shortToken).join(' '));
    return { key, kind, verb, target: null, state, path: null, change: null };
  }
  const rest = command ? words : words.slice(1);
  const verb = STEP_VERBS[kind][state === 'active' ? 1 : 0];
  const target = kind === 'run' ? commandTarget(rest) : plainTarget(rest);
  return { key, kind, verb, target, state, path: filePath(kind, rest), change: null };
}

export function activityLines(steps: readonly StepView[], live: boolean): ActivityLine[] {
  const start = Math.max(0, steps.length - ACTIVITY_LINES);
  return steps.slice(start).map((step, offset) => activityLine(step, start + offset, live));
}

export function activityText(line: ActivityLine): string {
  const text = line.target ? `${line.verb} · ${line.target}` : line.verb;
  return line.change ? `${text} +${line.change.added} −${line.change.removed}` : text;
}

export function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function samePath(stepPath: string, changed: string): boolean {
  return (
    stepPath === changed || stepPath.endsWith(`/${changed}`) || changed.endsWith(`/${stepPath}`)
  );
}

export function changeFor(
  path: string,
  runIds: readonly string[],
  entries: readonly ChangeEntry[],
): LineChange | null {
  if (isSecretFileName(baseName(path))) return null;
  const matches = entries.filter(
    (entry) =>
      runIds.includes(entry.runId) &&
      entry.shown === 'text' &&
      entry.added !== null &&
      entry.removed !== null &&
      samePath(path, entry.path),
  );
  const [only] = matches;
  if (!only || matches.length > 1) return null;
  return {
    runId: only.runId,
    path: only.path,
    added: only.added ?? 0,
    removed: only.removed ?? 0,
  };
}

export function withChanges(
  lines: readonly ActivityLine[],
  runIds: readonly string[],
  entries: readonly ChangeEntry[],
): ActivityLine[] {
  if (runIds.length === 0 || entries.length === 0) return [...lines];
  return lines.map((line) =>
    line.kind === 'edit' && line.path && line.state !== 'failed'
      ? { ...line, change: changeFor(line.path, runIds, entries) }
      : line,
  );
}

export function quickStartProject(
  chats: readonly ConversationSummary[],
  projects: readonly Project[],
): Project | null {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const recent = chats
    .filter((chat) => !chat.archivedAt)
    .toSorted(byRecent)
    .flatMap((chat) => chat.projectIds.flatMap((id) => byId.get(id) ?? []))[0];
  return recent ?? projects[0] ?? null;
}
