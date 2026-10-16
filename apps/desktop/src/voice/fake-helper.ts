import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

type Request = Record<string, unknown> & { id: string; op: string };

const SPOKEN_MS = 200;
const HEARD_MS = 150;

export function fakeVoiceHelper(): ChildProcessWithoutNullStreams {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const say = (message: Record<string, unknown>) => stdout.write(`${JSON.stringify(message)}\n`);
  const transcript = process.env.SPARK_FAKE_VOICE_TEXT ?? 'who needs me';
  const listening = new Map<string, NodeJS.Timeout | null>();
  let speaking: { id: string; timer: NodeJS.Timeout } | null = null;
  let buffer = '';

  const hush = () => {
    if (!speaking) return;
    clearTimeout(speaking.timer);
    say({ id: speaking.id, event: 'interrupted' });
    speaking = null;
  };

  const handle = (request: Request) => {
    const { id } = request;
    switch (request.op) {
      case 'status':
        return say({
          id,
          event: 'status',
          mic: 'granted',
          inputMonitoring: false,
          model: false,
          fnSetting: 'free',
          arch: 'arm64',
        });
      case 'load':
        return say({ id, event: 'loaded' });
      case 'keys':
        return say({ id, event: 'keys' });
      case 'listen': {
        hush();
        const text = typeof request.file === 'string' ? request.file : transcript;
        say({ id, event: 'level', level: 0.4 });
        say({ id, event: 'speech' });
        if (request.purpose === 'dictation') {
          say({ id, event: 'partial', text });
          listening.set(id, null);
          return undefined;
        }
        listening.set(
          id,
          setTimeout(() => {
            listening.delete(id);
            say({ id, event: 'final', text, reason: 'paused' });
          }, HEARD_MS),
        );
        return undefined;
      }
      case 'stop': {
        if (!listening.has(id)) return undefined;
        clearTimeout(listening.get(id) ?? undefined);
        listening.delete(id);
        return say({ id, event: 'final', text: transcript, reason: 'stopped' });
      }
      case 'cancel': {
        if (!listening.has(id)) return undefined;
        clearTimeout(listening.get(id) ?? undefined);
        listening.delete(id);
        return say({ id, event: 'cancelled' });
      }
      case 'speak':
        hush();
        speaking = {
          id,
          timer: setTimeout(() => {
            speaking = null;
            say({ id, event: 'spoken' });
          }, SPOKEN_MS),
        };
        return undefined;
      case 'hush':
        hush();
        return say({ id, event: 'hushed' });
      default:
        return say({ id, event: 'error', error: 'invalid', detail: 'unknown op' });
    }
  };

  stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      handle(JSON.parse(line) as Request);
    }
  });

  return Object.assign(events, {
    stdin,
    stdout,
    stderr,
    pid: 0,
    kill: () => {
      for (const timer of listening.values()) clearTimeout(timer ?? undefined);
      if (speaking) clearTimeout(speaking.timer);
      events.emit('exit', null);
      return true;
    },
  }) as unknown as ChildProcessWithoutNullStreams;
}
