import {
  BOOT_TEASER_NAME_MAX,
  BOOT_TEASER_NAMES_MAX,
  type BootTeaser,
  type BootTeaserSnapshot,
  type DigestState,
  type TeammateList,
  type TeammateState,
  type TodaySummary,
} from '@spark-outpost/contracts';

export interface TeaserSources {
  activeRuns: number;
  today: TodaySummary;
  digest: DigestState;
  teammates: TeammateList;
}

export interface TeaserInput {
  snapshot: BootTeaserSnapshot | null;
  changelog: string;
  version: string;
  defaultShortcut: boolean;
  now: Date;
  timeZone?: string;
  random: () => number;
}

const AWAY_MAX = 3;
const HEADLINE_MAX = 60;
const AWAY = 'While you were away';
const SHORTCUT_TIP = '⌥Space starts a chat from anywhere';
const TIPS = [
  'Try the Sky view on a project’s Map: the whole repo as stars',
  'The context ring in the message box shows how full a chat is',
  'Answer Spark Island cards with Y and N',
  'Sparks are named teammates with a face, a role and their own chat',
];

function sparkNames(list: TeammateList, state: TeammateState): string[] {
  return list.teammates
    .filter((teammate) => teammate.state === state)
    .map((teammate) => teammate.name.trim().slice(0, BOOT_TEASER_NAME_MAX).trim())
    .filter((name) => name.length > 0)
    .slice(0, BOOT_TEASER_NAMES_MAX);
}

export function teaserSnapshot(sources: TeaserSources, now: Date): BootTeaserSnapshot {
  const digest = sources.digest.digest;
  return {
    savedAt: now.toISOString(),
    running: sources.activeRuns,
    needsYou: sources.today.waiting,
    prs: sources.today.prs,
    briefAt: digest?.status === 'ready' ? digest.finishedAt : null,
    busy: sparkNames(sources.teammates, 'working'),
    waiting: sparkNames(sources.teammates, 'needs_you'),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function nameList(names: readonly string[]): string {
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function sameDay(first: Date, second: Date, timeZone: string | undefined): boolean {
  const day = (date: Date) => date.toLocaleDateString('en-CA', { timeZone });
  return day(first) === day(second);
}

function awayLines(snapshot: BootTeaserSnapshot, now: Date, timeZone?: string): string[] {
  const savedToday = sameDay(new Date(snapshot.savedAt), now, timeZone);
  const lines: string[] = [];
  if (snapshot.waiting.length > 0) {
    const verb = snapshot.waiting.length === 1 ? 'is' : 'are';
    lines.push(`${nameList(snapshot.waiting)} ${verb} waiting on you 👀`);
  }
  if (snapshot.needsYou > 0) {
    lines.push(plural(snapshot.needsYou, 'chat needs you', 'chats need you'));
  }
  if (snapshot.running > 0) {
    const verb = snapshot.running === 1 ? 'was' : 'were';
    lines.push(`${plural(snapshot.running, 'chat', 'chats')} ${verb} still running when you left…`);
  }
  if (snapshot.busy.length > 0) {
    const verb = snapshot.busy.length === 1 ? 'was' : 'were';
    lines.push(`${nameList(snapshot.busy)} ${verb} busy when you left`);
  }
  if (snapshot.prs > 0) {
    const when = savedToday ? 'today' : 'last time';
    lines.push(`${plural(snapshot.prs, 'pull request', 'pull requests')} opened ${when}`);
  }
  if (snapshot.briefAt && sameDay(new Date(snapshot.briefAt), now, timeZone)) {
    const time = new Date(snapshot.briefAt).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
    lines.push(`Your morning brief is ready, made at ${time}`);
  }
  return lines.slice(0, AWAY_MAX);
}

function headline(bullet: string): string {
  const plain = bullet.replace(/[`*_]/g, '').trim();
  let text = plain.split(/[:.](?:\s|$)/)[0] ?? plain;
  if (text.length > HEADLINE_MAX) text = text.split(', ')[0] ?? text;
  if (text.length <= HEADLINE_MAX) return text;
  const cut = text.slice(0, HEADLINE_MAX - 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export function whatsNew(changelog: string, version: string, count: number): string[] {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) return [];
  const notes: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('- ')) notes.push(headline(line.slice(2)));
    if (notes.length === count) break;
  }
  return notes.filter((note) => note.length > 0);
}

function pickTip(defaultShortcut: boolean, random: () => number): string {
  const tips = defaultShortcut ? [SHORTCUT_TIP, ...TIPS] : TIPS;
  return tips[Math.floor(random() * tips.length)] ?? TIPS[0] ?? SHORTCUT_TIP;
}

export function teaserLines(input: TeaserInput): BootTeaser[] {
  const away = input.snapshot ? awayLines(input.snapshot, input.now, input.timeZone) : [];
  const notes = whatsNew(input.changelog, input.version, away.length > 0 ? 1 : 2);
  return [
    ...away.map((text) => ({ label: AWAY, text })),
    ...notes.map((text) => ({ label: `New in ${input.version}`, text })),
    { label: 'Tip', text: pickTip(input.defaultShortcut, input.random) },
  ];
}
