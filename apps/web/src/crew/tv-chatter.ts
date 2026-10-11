import { isBusy, type CrewAgent } from './crew-model.ts';

export interface Chatter {
  agentId: string;
  text: string;
  pinned: boolean;
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

const QUIET_LINES = new Set(['thinking', 'queued']);

export function doingLine(line: string): string {
  const [verb = '', ...rest] = line.trim().split(/\s+/);
  const gerund = GERUNDS[verb.toLowerCase()];
  const text = gerund ? [gerund, ...rest].join(' ') : line.charAt(0).toUpperCase() + line.slice(1);
  return `${text}…`;
}

function agentChanges(before: CrewAgent | undefined, after: CrewAgent, lead: boolean): Chatter[] {
  if (!before) return [];
  const chatter: Chatter[] = [];
  const stepped = isBusy(after.state) && isBusy(before.state) && before.line !== after.line;
  if (stepped && !QUIET_LINES.has(after.line)) {
    chatter.push({ agentId: after.id, text: doingLine(after.line), pinned: false });
  }
  if (after.state === 'done' && before.state !== 'done') {
    const text = lead ? 'All done. Ready for you!' : 'Step done!';
    chatter.push({ agentId: after.id, text, pinned: true });
  }
  if (after.state === 'failed' && before.state !== 'failed') {
    chatter.push({ agentId: after.id, text: 'Hit a problem.', pinned: true });
  }
  return chatter;
}

export function sceneChatter(
  before: readonly CrewAgent[] | null,
  after: readonly CrewAgent[],
): Chatter[] {
  if (!before) return [];
  const previous = new Map(before.map((agent) => [agent.id, agent]));
  return after.flatMap((agent, index) => agentChanges(previous.get(agent.id), agent, index === 0));
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
