import type { ConversationSummary, PlanProgress, Project } from '@spark-outpost/contracts';
import type { StepView } from '../chat/run-projection.ts';
import { hideSecrets } from '../chat/status/status-text.ts';
import { STEP_VERBS, stepKind, type StepKind } from '../chat/status/step-activity.ts';
import { sessionState } from './island-model.ts';

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

export type ActivityState = 'done' | 'active' | 'failed';

export interface ActivityLine {
  key: string;
  kind: StepKind;
  verb: string;
  target: string | null;
  state: ActivityState;
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

function plainTarget(words: string[]): string | null {
  const path = words.find((word) => PATH_TOKEN.test(tidyToken(word)) || URL_TOKEN.test(word));
  if (path) return clip(shortToken(path));
  const text = words.map(shortToken).join(' ').trim();
  return text ? clip(text) : null;
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
    return { key, kind, verb: clip(words.map(shortToken).join(' ')), target: null, state };
  }
  const rest = command ? words : words.slice(1);
  const verb = STEP_VERBS[kind][state === 'active' ? 1 : 0];
  const target = kind === 'run' ? commandTarget(rest) : plainTarget(rest);
  return { key, kind, verb, target, state };
}

export function activityLines(steps: readonly StepView[], live: boolean): ActivityLine[] {
  const start = Math.max(0, steps.length - ACTIVITY_LINES);
  return steps.slice(start).map((step, offset) => activityLine(step, start + offset, live));
}

export function activityText(line: ActivityLine): string {
  return line.target ? `${line.verb} · ${line.target}` : line.verb;
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
