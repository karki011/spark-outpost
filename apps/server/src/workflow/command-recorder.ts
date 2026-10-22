import { homedir } from 'node:os';
import path from 'node:path';
import {
  COMMAND_CHUNK_CHARS,
  COMMAND_FINISHED,
  COMMAND_LIVE_CHARS,
  COMMAND_OUTPUT,
  COMMAND_STARTED,
  COMMAND_STORED_CHARS,
  COMMAND_TEXT_MAX,
  EventType,
  createOutputSanitizer,
  outputTail,
  type CommandFinished,
  type CommandOutput,
  type CommandStarted,
  type OutputSanitizer,
  type RunEvent,
} from '@spark-outpost/contracts';
import { storableText } from '../audit/redact.ts';
import {
  createRedactionFilter,
  redactSecrets,
  type RedactionFilter,
} from '../audit/redact-stream.ts';
import { shotAnchor } from '../persistence/browser-screenshots.ts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { finishCommand, insertCommand, saveCommandOutput } from '../persistence/run-commands.ts';
import type { ProviderOutput } from '../providers/provider.ts';

export const COMMAND_FLUSH_MS = 100;
export const COMMAND_SAVE_MS = 1_000;

type CommandEvent = Extract<
  ProviderOutput,
  { kind: 'command_started' | 'command_output' | 'command_finished' }
>;

export interface CommandRecorderOptions {
  db: Queryable;
  runId: string;
  append: (event: RunEvent) => Promise<unknown>;
  secretValues: readonly string[];
  projectRoots: readonly string[];
  chatFolder?: boolean;
  replySoFar: () => { shown: string; held: number };
  flushMs?: number;
  saveMs?: number;
  now?: () => number;
}

export interface CommandRecorder {
  observe(output: ProviderOutput): Promise<void>;
  close(): Promise<void>;
}

interface OpenCommand {
  id: string;
  sanitizer: OutputSanitizer;
  redaction: RedactionFilter;
  tail: string;
  total: number;
  pending: string;
  sent: number;
  gapped: boolean;
  resets: boolean;
  timer: NodeJS.Timeout | null;
  savedAt: number;
}

function isCommandEvent(output: ProviderOutput): output is CommandEvent {
  return (
    output.kind === 'command_started' ||
    output.kind === 'command_output' ||
    output.kind === 'command_finished'
  );
}

export function cwdLabel(cwd: string | null, roots: readonly string[]): string | null {
  if (!cwd) return null;
  for (const root of roots) {
    const relative = path.relative(root, cwd);
    if (relative === '') return './';
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) return `./${relative}`;
  }
  const home = homedir();
  return cwd === home || cwd.startsWith(`${home}${path.sep}`) ? `~${cwd.slice(home.length)}` : cwd;
}

function shownCwd(
  cwd: string | null,
  options: Pick<CommandRecorderOptions, 'projectRoots' | 'chatFolder'>,
): string | null {
  const label = cwdLabel(cwd, options.projectRoots);
  return options.chatFolder && label === './' ? null : label;
}

const custom = (name: string, value: unknown): RunEvent => ({
  type: EventType.CUSTOM,
  name,
  value,
});

export function createCommandRecorder(options: CommandRecorderOptions): CommandRecorder {
  const { db, runId, append, secretValues } = options;
  const flushMs = options.flushMs ?? COMMAND_FLUSH_MS;
  const saveMs = options.saveMs ?? COMMAND_SAVE_MS;
  const now = options.now ?? Date.now;
  const open = new Map<string, OpenCommand>();
  let last: Promise<unknown> = Promise.resolve();

  const inOrder = <Result>(work: () => Promise<Result>): Promise<Result> => {
    const next = last.then(work);
    last = next.catch(() => undefined);
    return next;
  };

  const start = async (output: Extract<CommandEvent, { kind: 'command_started' }>) => {
    if (open.has(output.id)) return;
    const started: CommandStarted = {
      id: newId(),
      command: redactSecrets(storableText(output.command), secretValues).slice(0, COMMAND_TEXT_MAX),
      cwd: shownCwd(output.cwd ?? options.projectRoots[0] ?? null, options),
      live: output.live,
      startedAt: new Date(now()).toISOString(),
      ...shotAnchor(options.replySoFar().shown, options.replySoFar().held),
    };
    open.set(output.id, {
      id: started.id,
      sanitizer: createOutputSanitizer(),
      redaction: createRedactionFilter(secretValues),
      tail: '',
      total: 0,
      pending: '',
      sent: 0,
      gapped: false,
      resets: false,
      timer: null,
      savedAt: now(),
    });
    await inOrder(async () => {
      await insertCommand(db, runId, started);
      await append(custom(COMMAND_STARTED, started));
    });
  };

  const take = (command: OpenCommand, clean: string) => {
    const text = storableText(clean);
    if (text === '') return;
    command.tail = outputTail(command.tail + text, COMMAND_STORED_CHARS);
    command.total += text.length;
    command.pending += text;
  };

  const flush = (command: OpenCommand): Promise<void> => {
    if (command.timer) clearTimeout(command.timer);
    command.timer = null;
    const waiting = command.pending;
    command.pending = '';
    if (waiting === '') return Promise.resolve();
    if (command.sent >= COMMAND_LIVE_CHARS) {
      command.gapped = true;
      return Promise.resolve();
    }
    const chunk = outputTail(waiting, COMMAND_CHUNK_CHARS);
    command.gapped ||= chunk.length < waiting.length;
    command.sent += chunk.length;
    const event: CommandOutput = {
      id: command.id,
      at: command.total - chunk.length,
      chunk,
      ...(command.resets ? { reset: true } : {}),
    };
    command.resets = false;
    const save = now() - command.savedAt >= saveMs;
    if (save) command.savedAt = now();
    const { tail, total } = command;
    return inOrder(async () => {
      await append(custom(COMMAND_OUTPUT, event));
      if (save) await saveCommandOutput(db, command.id, tail, total);
    });
  };

  const add = async (output: Extract<CommandEvent, { kind: 'command_output' }>) => {
    const command = open.get(output.id);
    if (!command) return;
    if (output.replace) {
      command.sanitizer = createOutputSanitizer();
      command.redaction = createRedactionFilter(secretValues);
      Object.assign(command, { tail: '', total: 0, pending: '', resets: true });
    }
    take(command, command.redaction.push(command.sanitizer.push(output.data)));
    if (command.pending.length >= COMMAND_CHUNK_CHARS) {
      await flush(command);
      return;
    }
    command.timer ??= setTimeout(() => void flush(command).catch(() => undefined), flushMs);
  };

  const finish = async (
    key: string,
    status: CommandFinished['status'],
    exitCode: number | null,
  ) => {
    const command = open.get(key);
    if (!command) return;
    open.delete(key);
    take(command, command.redaction.finish());
    await flush(command);
    const finished: CommandFinished = {
      id: command.id,
      status,
      exitCode,
      finishedAt: new Date(now()).toISOString(),
      outputChars: command.total,
    };
    const whole: CommandOutput = {
      id: command.id,
      at: command.total - command.tail.length,
      chunk: command.tail,
      reset: true,
    };
    await inOrder(async () => {
      if (command.gapped) await append(custom(COMMAND_OUTPUT, whole));
      await finishCommand(db, finished, command.tail);
      await append(custom(COMMAND_FINISHED, finished));
    });
  };

  return {
    async observe(output) {
      if (!isCommandEvent(output)) return;
      if (output.kind === 'command_started') await start(output);
      if (output.kind === 'command_output') await add(output);
      if (output.kind === 'command_finished') {
        await finish(output.id, output.failed ? 'failed' : 'completed', output.exitCode);
      }
    },
    async close() {
      for (const key of [...open.keys()]) await finish(key, 'interrupted', null);
    },
  };
}
