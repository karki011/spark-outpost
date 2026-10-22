import { friendlyStep } from '@spark-outpost/contracts';
import { clipText, commandFull, commandSummary, fileName, hideSecrets } from './status-text.ts';

export type StepKind = 'read' | 'edit' | 'run' | 'search' | 'think' | 'other';

const KINDS: [StepKind, RegExp][] = [
  ['read', /^(read|reading|view|viewing|cat|open|opening|fetched)$/i],
  [
    'edit',
    /^(edit|editing|edited|write|writing|wrote|modify|modifying|modified|update|updating|create|creating|patch|patching|multiedit|apply|applying)$/i,
  ],
  ['run', /^(run|running|ran|bash|terminal|execute|executing|exec)$/i],
  [
    'search',
    /^(search|searching|searched|grep|glob|find|finding|list|listing|ls|fetch|fetching|websearch|webfetch)$/i,
  ],
  ['think', /^(think|thinking|thought)$/i],
];

export const STEP_VERBS: Record<Exclude<StepKind, 'other'>, [done: string, active: string]> = {
  read: ['Read', 'Reading'],
  edit: ['Edited', 'Editing'],
  run: ['Ran', 'Running'],
  search: ['Searched', 'Searching'],
  think: ['Thought', 'Thinking'],
};

export function stepKind(word: string | undefined): StepKind {
  if (!word) return 'other';
  const bare = word.replace(/[:.]$/, '');
  return KINDS.find(([, pattern]) => pattern.test(bare))?.[0] ?? 'other';
}

export interface StepActivity {
  kind: StepKind;
  verb: string;
  target: string | null;
  code: boolean;
  full: string;
}

const FILE_TOKEN = /[\\/]|^[\w@.-]+\.[a-z0-9]{1,8}$/i;

function quoted(text: string): string | null {
  return text.match(/`([^`]+)`/)?.[1] ?? null;
}

function fileTarget(rest: string): string | null {
  const token =
    quoted(rest) ?? rest.split(/\s+/).find((word) => FILE_TOKEN.test(word.replace(/[,;:]$/, '')));
  if (!token || !FILE_TOKEN.test(token)) return null;
  return fileName(token.replace(/:\d*(:\d+)?$/, ''));
}

function plain(text: string): string {
  return text.replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

export function stepActivity(name: string): StepActivity {
  const safe = hideSecrets(friendlyStep(name)).trim();
  const full = plain(safe);
  if (safe.startsWith('`')) {
    const command = quoted(safe) ?? full;
    return { kind: 'run', verb: 'Running', target: commandSummary(command), code: true, full };
  }
  const [first = '', ...words] = safe.split(/\s+/);
  const kind = stepKind(first);
  const rest = words.join(' ');
  if (kind === 'think') return { kind, verb: 'Thinking…', target: null, code: false, full };
  if (kind === 'run' && rest) {
    const command = quoted(rest) ?? rest;
    return {
      kind,
      verb: 'Running',
      target: commandSummary(command),
      code: true,
      full: commandFull(command),
    };
  }
  if (kind === 'read' || kind === 'edit') {
    const target = fileTarget(rest);
    if (target) return { kind, verb: STEP_VERBS[kind][1], target, code: false, full };
  }
  if (kind === 'search' && rest) {
    return { kind, verb: 'Searching', target: clipText(plain(rest), 36), code: false, full };
  }
  return { kind, verb: clipText(full), target: null, code: false, full };
}
