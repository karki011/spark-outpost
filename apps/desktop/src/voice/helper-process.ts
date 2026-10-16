import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { voiceHelperMessageSchema, type VoiceHelperMessage } from '@spark-outpost/contracts';

export type VoiceHelperRequest =
  | { op: 'status' }
  | { op: 'load'; path: string; sha256: string; vad: string }
  | { op: 'listen'; purpose: string; language: string; hint: string; file?: string }
  | { op: 'stop' | 'cancel'; id: string }
  | { op: 'speak'; text: string; voice?: string }
  | { op: 'hush' }
  | { op: 'keys'; fn: boolean; hold: boolean };

export type SpawnVoiceHelper = () => ChildProcessWithoutNullStreams;

export interface VoiceHelper {
  send(request: VoiceHelperRequest, id?: string): string;
  ask(request: VoiceHelperRequest, done: (message: VoiceHelperMessage) => boolean): Promise<VoiceHelperMessage>;
  onMessage(listener: (message: VoiceHelperMessage) => void): void;
  onExit(listener: () => void): void;
  running(): boolean;
  kill(): void;
}

export interface VoiceHelperOptions {
  spawn: SpawnVoiceHelper;
  log(line: string): void;
  newId?: () => string;
  timeoutMs?: number;
}

export function spawnVoiceBinary(binary: string, allowFileInput: boolean): SpawnVoiceHelper {
  return () =>
    spawnProcess(binary, allowFileInput ? ['--allow-file-input'] : [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {},
    });
}

export class VoiceHelperGone extends Error {}

export function startVoiceHelper(options: VoiceHelperOptions): VoiceHelper {
  const newId = options.newId ?? randomUUID;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const listeners: ((message: VoiceHelperMessage) => void)[] = [];
  const exits: (() => void)[] = [];
  const asking = new Map<string, { done: (message: VoiceHelperMessage) => boolean; fail(error: Error): void }>();
  let child: ChildProcessWithoutNullStreams | null = null;

  const read = (line: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      options.log('The voice helper wrote a line that is not JSON.');
      return;
    }
    const parsed = voiceHelperMessageSchema.safeParse(raw);
    if (!parsed.success) {
      options.log('The voice helper sent a message Spark cannot read.');
      return;
    }
    const message = parsed.data;
    const waiting = message.id === null ? undefined : asking.get(message.id);
    if (waiting && waiting.done(message) && message.id !== null) asking.delete(message.id);
    for (const listener of listeners) listener(message);
  };

  const ensure = (): ChildProcessWithoutNullStreams => {
    if (child) return child;
    const started = options.spawn();
    child = started;
    createInterface({ input: started.stdout }).on('line', read);
    started.stderr.on('data', (chunk: Buffer) => {
      options.log(`voice helper: ${chunk.toString('utf8').trim().slice(0, 300)}`);
    });
    const gone = (reason: string) => {
      if (child !== started) return;
      child = null;
      options.log(`The voice helper ${reason}.`);
      for (const waiting of asking.values()) waiting.fail(new VoiceHelperGone(reason));
      asking.clear();
      for (const exit of exits) exit();
    };
    started.once('error', (error) => gone(`could not start: ${error.message}`));
    started.once('exit', (code) => gone(`exited (${code ?? 'signal'})`));
    started.stdin.on('error', () => undefined);
    return started;
  };

  const send = (request: VoiceHelperRequest, id = newId()) => {
    const body = request.op === 'stop' || request.op === 'cancel' ? { op: request.op, id: request.id } : { ...request, id };
    ensure().stdin.write(`${JSON.stringify(body)}\n`);
    return body.id;
  };

  return {
    send,
    ask(request, done) {
      return new Promise((resolve, reject) => {
        const id = newId();
        const timer = setTimeout(() => {
          asking.delete(id);
          reject(new VoiceHelperGone('did not answer in time'));
        }, timeoutMs);
        asking.set(id, {
          done: (message) => {
            if (!done(message)) return false;
            clearTimeout(timer);
            resolve(message);
            return true;
          },
          fail: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        try {
          send(request, id);
        } catch (error) {
          asking.delete(id);
          clearTimeout(timer);
          reject(error as Error);
        }
      });
    },
    onMessage: (listener) => void listeners.push(listener),
    onExit: (listener) => void exits.push(listener),
    running: () => child !== null,
    kill() {
      const running = child;
      running?.kill('SIGKILL');
    },
  };
}
