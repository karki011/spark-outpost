import type { TicketMoveStatuses, TicketStatus, TicketStatusMap } from '@spark-outpost/contracts';
import {
  bucketOf,
  noStateMessage,
  projectMap,
  sameName,
  shouldMove,
  type SourceState,
} from './status.ts';

export type MoveRequest = { group: TicketStatus } | { name: string };

export type MoveRule = 'project_setting' | 'setting' | 'name' | 'only_status' | 'exact';

export type MoveStop = 'unchanged' | 'no_status' | 'blocked';

export interface MoveSettings {
  mapped: Partial<Record<TicketStatus, string>>;
  chosen: TicketMoveStatuses;
}

export interface SourceMoveSettings {
  statusMap: TicketStatusMap;
  moveStatuses: TicketMoveStatuses;
}

export function settingsFor(moves: SourceMoveSettings, project: string | null): MoveSettings {
  return { mapped: projectMap(moves.statusMap, project), chosen: moves.moveStatuses };
}

export interface MovePlan {
  from: string;
  to: string | null;
  status: TicketStatus | null;
  rule: MoveRule | null;
  stopped: MoveStop | null;
  message: string | null;
  statuses: string[];
}

interface GroupNames {
  first: readonly string[];
  other: readonly string[];
  never: readonly string[];
  word: string;
}

const GROUPS: Record<TicketStatus, GroupNames> = {
  todo: { first: ['To Do', 'Todo'], other: ['Backlog', 'Open'], never: [], word: 'to-do' },
  in_progress: {
    first: ['In Progress'],
    other: ['Doing', 'In Development', 'Development'],
    never: ['Blocked', 'On Hold'],
    word: 'in-progress',
  },
  in_review: {
    first: ['In Review'],
    other: ['Code Review', 'Review', 'Reviewing'],
    never: [],
    word: 'review',
  },
  done: {
    first: ['Done'],
    other: ['Closed', 'Resolved', 'Complete', 'Completed'],
    never: [
      'Rejected',
      "Won't Do",
      "Won't Fix",
      'Wontfix',
      'Cancelled',
      'Canceled',
      'Declined',
      'Duplicate',
      'Invalid',
      'Abandoned',
      'Not Doing',
      'Obsolete',
    ],
    word: 'finished',
  },
};

const plain = (name: string) => name.trim().toLowerCase().replaceAll('’', "'");
const listed = (names: readonly string[], name: string) =>
  names.some((entry) => plain(entry) === plain(name));

export type GroupTarget<T> =
  | { found: true; state: T; rule: MoveRule }
  | { found: false; problem: 'none' | 'ambiguous' | 'never'; names: string[] };

export function effectiveMap(settings: MoveSettings): Partial<Record<TicketStatus, string>> {
  return { ...settings.chosen, ...settings.mapped };
}

export function resolveGroup<T extends SourceState>(
  statuses: readonly T[],
  target: TicketStatus,
  settings: MoveSettings,
): GroupTarget<T> {
  const byName = (name: string) => statuses.find((state) => sameName(state.name, name));
  const mapped = settings.mapped[target];
  if (mapped) {
    const state = byName(mapped);
    return state
      ? { found: true, state, rule: 'project_setting' }
      : { found: false, problem: 'none', names: [] };
  }
  const chosen = target === 'todo' ? undefined : settings.chosen[target];
  const picked = chosen ? byName(chosen) : undefined;
  if (picked) return { found: true, state: picked, rule: 'setting' };

  const map = effectiveMap(settings);
  const group = statuses.filter((state) => bucketOf(state, map) === target);
  const names = GROUPS[target];
  const allowed = group.filter((state) => !listed(names.never, state.name));
  for (const name of names.first) {
    const state = allowed.find((entry) => plain(entry.name) === plain(name));
    if (state) return { found: true, state, rule: 'name' };
  }
  const others = allowed.filter((state) => listed(names.other, state.name));
  if (others.length === 1) return { found: true, state: others[0]!, rule: 'name' };
  if (allowed.length === 1) return { found: true, state: allowed[0]!, rule: 'only_status' };
  const all = group.map((state) => state.name);
  if (group.length === 0) return { found: false, problem: 'none', names: [] };
  return { found: false, problem: allowed.length === 0 ? 'never' : 'ambiguous', names: all };
}

export const groupWord = (target: TicketStatus) => GROUPS[target].word;

export interface MoveContext {
  sourceName: string;
  project: string | null;
}

export function groupProblemText(
  target: TicketStatus,
  unresolved: { problem: 'none' | 'ambiguous' | 'never'; names: readonly string[] },
  context: MoveContext,
): string {
  const settings = `Settings → Connectors → ${context.sourceName}`;
  if (unresolved.problem === 'none') return noStateMessage(target, context.project);
  const names = unresolved.names.join(', ');
  if (unresolved.problem === 'never') {
    return `Spark never picks ${names} on its own. Choose a status in ${settings}.`;
  }
  return `this project has several ${GROUPS[target].word} statuses (${names}). Choose one in ${settings}.`;
}

export interface MoveFacts extends MoveContext {
  key: string;
  current: SourceState;
  statuses: readonly SourceState[];
  reachable: readonly SourceState[] | null;
  request: MoveRequest;
  settings: MoveSettings;
}

export function planMove(facts: MoveFacts): MovePlan {
  const { key, current, statuses, request, settings } = facts;
  const map = effectiveMap(settings);
  const names = statuses.map((state) => state.name);
  const stop = (stopped: MoveStop, message: string): MovePlan => ({
    from: current.name,
    to: null,
    status: null,
    rule: null,
    stopped,
    message,
    statuses: names,
  });
  const notMoved = (why: string) => stop('blocked', `${key} was not moved: ${why}`);

  let state: SourceState;
  let rule: MoveRule;
  if ('group' in request) {
    const decision = shouldMove(bucketOf(current, map), request.group);
    if (!decision.move) return stop('unchanged', decision.reason);
    const target = resolveGroup(statuses, request.group, settings);
    if (!target.found) {
      const text = groupProblemText(request.group, target, facts);
      return target.problem === 'none' ? stop('no_status', text) : notMoved(text);
    }
    ({ state, rule } = target);
  } else {
    const named = statuses.find((entry) => sameName(entry.name, request.name));
    if (!named) {
      return stop(
        'no_status',
        `${key} has no status named ${request.name.trim()}. Its statuses: ${names.join(', ')}.`,
      );
    }
    state = named;
    rule = 'exact';
  }
  if (sameName(state.name, current.name)) return stop('unchanged', `Already ${state.name}.`);
  if (facts.reachable && !facts.reachable.some((entry) => sameName(entry.name, state.name))) {
    return notMoved(
      `the ${facts.sourceName} workflow does not allow moving it from ${current.name} to ${state.name}.`,
    );
  }
  return {
    from: current.name,
    to: state.name,
    status: bucketOf(state, map),
    rule,
    stopped: null,
    message: null,
    statuses: names,
  };
}
