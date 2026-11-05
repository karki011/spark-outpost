import {
  nativeTerminalProviderSchema,
  type NativeTerminalProvider,
} from '@spark-outpost/contracts';

export const START_PHASES = [
  'locate_cli',
  'prepare_session',
  'worktree',
  'grant',
  'prepare_launch',
  'spawn',
  'new_session',
  'attach',
  'first_output',
] as const;

export type StartPhase = (typeof START_PHASES)[number];
export type StartOutcome = 'started' | 'failed' | 'ended_before_output';
export type StartWorktree = 'created' | 'reused' | 'none';

export interface StartRecord {
  sessionId: string | null;
  provider: NativeTerminalProvider | null;
  outcome: StartOutcome;
  totalMs: number;
  tmux: boolean | null;
  worktree: StartWorktree | null;
  phases: Partial<Record<StartPhase, number>>;
  failedIn: StartPhase | null;
  error: unknown;
}

export interface StartObserver {
  begin(phase: StartPhase): () => void;
  tmux(used: boolean): void;
  ended(): void;
}

interface Placed {
  input: { chatWorktree?: boolean };
  note: string | null;
}

export interface StartTimer {
  observer: StartObserver;
  provider(provider: NativeTerminalProvider): void;
  session(id: string): void;
  time<T>(phase: StartPhase, work: () => Promise<T>): Promise<T>;
  place<A extends unknown[], P extends Placed>(
    place: (...args: A) => Promise<P>,
  ): (...args: A) => Promise<P>;
  watch<T>(work: Promise<T>): Promise<T>;
}

const SESSION_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;
const PROVIDERS: readonly string[] = nativeTerminalProviderSchema.options;

const ms = (value: number) => String(Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

function errorFields(error: unknown): string[] {
  if (!(error instanceof Error)) return ['error=unknown'];
  const name = error.constructor.name;
  const status = (error as { status?: unknown }).status;
  const code =
    (error as { code?: unknown }).code ?? (error.cause as { code?: unknown } | undefined)?.code;
  return [
    `error=${ERROR_NAME.test(name) ? name : 'unknown'}`,
    ...(Number.isInteger(status) ? [`status=${status as number}`] : []),
    ...(typeof code === 'string' && ERROR_CODE.test(code) ? [`code=${code}`] : []),
  ];
}

const DEPS_WORDS: readonly string[] = [
  'prepared',
  'failed',
  'stopped',
  'nothing',
  'clone',
  'copy',
  'offline_install',
  'install',
  'skipped',
];
const word = (value: string | null) => (value && DEPS_WORDS.includes(value) ? value : 'none');

export function dependenciesLine(result: {
  sessionId: string | null;
  outcome: string;
  method: string | null;
  ms: number;
}): string {
  const session = result.sessionId && SESSION_ID.test(result.sessionId) ? result.sessionId : 'none';
  return `Terminal dependencies session=${session} outcome=${word(result.outcome)} method=${word(result.method)} total_ms=${ms(result.ms)}`;
}

export function worktreeOf(placed: Placed): StartWorktree {
  if (!placed.input.chatWorktree) return 'none';
  return placed.note ? 'created' : 'reused';
}

export function startLine(record: StartRecord): string {
  const session = record.sessionId && SESSION_ID.test(record.sessionId) ? record.sessionId : 'none';
  const provider =
    record.provider && PROVIDERS.includes(record.provider) ? record.provider : 'unknown';
  const fields = [
    `session=${session}`,
    `provider=${provider}`,
    `outcome=${record.outcome}`,
    `total_ms=${ms(record.totalMs)}`,
  ];
  if (record.tmux !== null) fields.push(`tmux=${record.tmux ? 'yes' : 'no'}`);
  if (record.worktree) fields.push(`worktree=${record.worktree}`);
  for (const phase of START_PHASES) {
    const spent = record.phases[phase];
    if (typeof spent === 'number' && Number.isFinite(spent))
      fields.push(`${phase}_ms=${ms(spent)}`);
    else if (phase === 'new_session' && record.tmux === false) fields.push('new_session=direct');
  }
  if (record.outcome === 'failed') {
    if (record.failedIn && START_PHASES.includes(record.failedIn))
      fields.push(`failed_in=${record.failedIn}`);
    fields.push(...errorFields(record.error));
  }
  return `Terminal start ${fields.join(' ')}`;
}

export function startTimer(
  log: (line: string) => void,
  now: () => number = () => performance.now(),
): StartTimer {
  const startedAt = now();
  const record: StartRecord = {
    sessionId: null,
    provider: null,
    outcome: 'started',
    totalMs: 0,
    tmux: null,
    worktree: null,
    phases: {},
    failedIn: null,
    error: null,
  };
  const open = new Set<StartPhase>();
  let began = false;
  let returned = false;
  let ended = false;
  let written = false;

  const write = (outcome: StartOutcome) => {
    if (written) return;
    written = true;
    log(startLine({ ...record, outcome }));
  };
  const settle = () => {
    if (record.phases.first_output !== undefined) write('started');
    else if (ended && began) write('ended_before_output');
  };
  const begin = (phase: StartPhase) => {
    const from = now();
    began = true;
    open.add(phase);
    return () => {
      if (!open.delete(phase)) return;
      record.phases[phase] = now() - from;
      if (phase === 'spawn') record.tmux ??= false;
      if (phase === 'first_output' && returned) settle();
    };
  };

  return {
    observer: {
      begin,
      tmux: (used) => {
        record.tmux = used;
      },
      ended: () => {
        ended = true;
        if (returned) settle();
      },
    },
    provider: (provider) => {
      record.provider = provider;
    },
    session: (id) => {
      record.sessionId = id;
    },
    time: async (phase, work) => {
      const end = begin(phase);
      const result = await work();
      end();
      return result;
    },
    place:
      (place) =>
      async (...args) => {
        const end = begin('worktree');
        const placed = await place(...args);
        end();
        record.worktree = worktreeOf(placed);
        return placed;
      },
    watch: (work) =>
      work.then(
        (result) => {
          record.totalMs = now() - startedAt;
          returned = true;
          settle();
          return result;
        },
        (error: unknown) => {
          if (began) {
            record.totalMs = now() - startedAt;
            record.error = error;
            record.failedIn =
              START_PHASES.findLast((phase) => phase !== 'first_output' && open.has(phase)) ?? null;
            write('failed');
          }
          throw error;
        },
      ),
  };
}
