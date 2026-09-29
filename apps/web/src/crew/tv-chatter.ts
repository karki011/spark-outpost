import { isBusy, isDispatcher, type CrewAgent } from './crew-model.ts';
import { JEV_ID } from './crew-projection.ts';

export interface TvScene {
  agents: readonly CrewAgent[];
  decision: string | null;
}

export interface Handoff {
  agentId: string;
  direction: 'out' | 'in';
}

export interface Chatter {
  agentId: string;
  text: string;
  pinned: boolean;
}

export interface SceneChanges {
  handoffs: Handoff[];
  chatter: Chatter[];
}

const GERUNDS: Record<string, string> = {
  read: 'Reading',
  edit: 'Editing',
  write: 'Writing',
  run: 'Running',
  search: 'Searching',
  update: 'Updating',
  create: 'Creating',
  delete: 'Deleting',
  fetch: 'Fetching',
  check: 'Checking',
  fix: 'Fixing',
  add: 'Adding',
  move: 'Moving',
  list: 'Listing',
  find: 'Finding',
  review: 'Reviewing',
  test: 'Testing',
};

const VERDICTS: Record<string, string> = {
  'looks good': 'Looks good to me.',
  'has concerns': 'I have some concerns.',
  unclear: "I'm not sure. Take a look?",
};

const QUIET_LINES = new Set(['thinking', 'queued', 'queued for review']);

export function doingLine(line: string): string {
  const [verb = '', ...rest] = line.trim().split(/\s+/);
  const gerund = GERUNDS[verb.toLowerCase()];
  const text = gerund ? [gerund, ...rest].join(' ') : line.charAt(0).toUpperCase() + line.slice(1);
  return `${text}…`;
}

function finishLine(agent: CrewAgent): string {
  if (agent.role === 'critic') return VERDICTS[agent.line] ?? 'Review done.';
  if (agent.role === 'scout') return 'Answered.';
  return 'Step done!';
}

function arrived(before: CrewAgent | undefined): boolean {
  return !before || before.state === 'queued';
}

function crewChanges(before: CrewAgent | undefined, after: CrewAgent): SceneChanges {
  const handoffs: Handoff[] = [];
  const chatter: Chatter[] = [];
  const busy = isBusy(after.state);
  if (busy && arrived(before)) {
    handoffs.push({ agentId: after.id, direction: 'out' });
    chatter.push({ agentId: JEV_ID, text: `Over to ${after.name}.`, pinned: true });
  } else if (busy && before && isBusy(before.state) && before.line !== after.line) {
    if (!QUIET_LINES.has(after.line))
      chatter.push({ agentId: after.id, text: doingLine(after.line), pinned: false });
  }
  if (after.state === 'done' && before && before.state !== 'done') {
    handoffs.push({ agentId: after.id, direction: 'in' });
    chatter.push({ agentId: after.id, text: finishLine(after), pinned: true });
  }
  if (after.state === 'failed' && before && before.state !== 'failed') {
    chatter.push({ agentId: after.id, text: 'Hit a problem.', pinned: true });
  }
  return { handoffs, chatter };
}

function jevChanges(before: CrewAgent | undefined, after: CrewAgent): Chatter[] {
  if (!before || before.line === after.line) return [];
  if (after.state === 'done' && after.line === 'ready for you') {
    return [{ agentId: after.id, text: 'All done. Ready for you!', pinned: true }];
  }
  return [];
}

export function sceneChanges(before: TvScene | null, after: TvScene): SceneChanges {
  if (!before) return { handoffs: [], chatter: [] };
  const previous = new Map(before.agents.map((agent) => [agent.id, agent]));
  const changes: SceneChanges = { handoffs: [], chatter: [] };
  if (after.decision && after.decision !== before.decision) {
    changes.chatter.push({ agentId: JEV_ID, text: after.decision, pinned: false });
  }
  for (const agent of after.agents) {
    const earlier = previous.get(agent.id);
    if (isDispatcher(agent)) {
      changes.chatter.push(...jevChanges(earlier, agent));
      continue;
    }
    const { handoffs, chatter } = crewChanges(earlier, agent);
    changes.handoffs.push(...handoffs);
    changes.chatter.push(...chatter);
  }
  return changes;
}

export function trimChatter(queue: readonly Chatter[], limit: number): Chatter[] {
  const kept = new Set(queue.filter((line) => !line.pinned).slice(-limit));
  return queue.filter((line) => line.pinned || kept.has(line));
}

export function nextChatter(
  queue: readonly Chatter[],
  asking: ReadonlySet<string>,
): { line: Chatter | null; rest: Chatter[] } {
  const speakable = queue.filter((line) => !asking.has(line.agentId));
  return { line: speakable[0] ?? null, rest: speakable.slice(1) };
}
