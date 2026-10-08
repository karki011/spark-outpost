import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isRecord } from '../agent-config/records.ts';
import { nativeHookNames, type NativeProvider } from './native-hooks.ts';

const exec = promisify(execFile);
const checks = new Map<string, Promise<boolean>>();
const normalise = (name: string) => name.replaceAll('_', '').toLowerCase();

export function verifyNativeOption(
  command: string,
  version: string,
  option: string,
): Promise<boolean> {
  const key = JSON.stringify(['option', command, version, option]);
  let pending = checks.get(key);
  if (!pending) {
    pending = exec(command, ['--help'], { timeout: 5000, maxBuffer: 1_000_000 })
      .then(({ stdout }) => stdout.split(/\s+/).includes(option))
      .catch(() => false)
      .then((supported) => {
        if (!supported) checks.delete(key);
        return supported;
      });
    checks.set(key, pending);
  }
  return pending;
}

export function supportsNativeHookEvents(
  provider: NativeProvider,
  events: readonly string[],
): boolean {
  const supported = new Set(events.map(normalise));
  return nativeHookNames(provider).every((event) => supported.has(normalise(event)));
}

export function verifyNativeHooks(
  provider: NativeProvider,
  command: string,
  version: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  const key = JSON.stringify([provider, command, version]);
  let pending = checks.get(key);
  if (!pending) {
    pending = probe(provider, command, signal)
      .catch(() => false)
      .then((supported) => {
        if (!supported) checks.delete(key);
        return supported;
      });
    checks.set(key, pending);
  }
  return pending;
}

async function probe(
  provider: NativeProvider,
  command: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const directory = await mkdtemp(join(tmpdir(), 'spark-native-capabilities-'));
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SHELL: process.env.SHELL,
    USER: process.env.USER,
    TMPDIR: directory,
    CLAUDE_CONFIG_DIR: directory,
    CODEX_HOME: directory,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    NO_COLOR: '1',
  };
  try {
    if (provider === 'codex') return await codexCapabilities(command, directory, env, signal);
    const groups = [{ hooks: [{ type: 'command', command: 'true', timeout: 3 }] }];
    const hooks = Object.fromEntries(nativeHookNames(provider).map((name) => [name, groups]));
    hooks.SparkCapabilityProbe = [];
    const { stdout } = await exec(
      command,
      ['--setting-sources', '', '--settings', JSON.stringify({ hooks }), 'doctor'],
      { cwd: directory, env, signal, timeout: 5000, maxBuffer: 1_000_000 },
    );
    const events = /Valid events:\s*([^\r\n]+)/
      .exec(stdout)?.[1]
      ?.split(',')
      .map((name) => name.trim());
    return Boolean(
      events &&
      !/›\s*hooks\.(?!SparkCapabilityProbe\b)/.test(stdout) &&
      supportsNativeHookEvents(provider, events),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function codexCapabilities(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<boolean> {
  const args = ['-c', 'features.hooks=true'];
  for (const event of nativeHookNames('codex'))
    args.push('-c', `hooks.${event}=[{hooks=[{type="command",command="true"}]}]`);
  args.push('app-server');
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { cwd, env, signal, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    let size = 0;
    let finished = false;
    const finish = (supported: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      resolve(supported);
    };
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
    const timer = setTimeout(() => finish(false), 5000);
    child.on('error', () => finish(false));
    child.on('exit', () => finish(false));
    child.stdin.on('error', () => finish(false));
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) return finish(false);
      buffer += chunk.toString('utf8');
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          return finish(false);
        }
        if (!isRecord(message)) continue;
        if (message.id === 1) {
          if (message.error) return finish(false);
          send({ method: 'initialized' });
          send({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } });
        }
        if (message.id === 2) return finish(supportedCodexResult(message.result));
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'spark-hook-capabilities', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

function supportedCodexResult(result: unknown): boolean {
  if (!isRecord(result) || !Array.isArray(result.data)) return false;
  return result.data.some((entry: unknown) => {
    if (
      !isRecord(entry) ||
      !Array.isArray(entry.hooks) ||
      !Array.isArray(entry.errors) ||
      entry.errors.length
    )
      return false;
    const events = entry.hooks.flatMap((hook: unknown) =>
      isRecord(hook) &&
      hook.source === 'sessionFlags' &&
      hook.enabled === true &&
      typeof hook.eventName === 'string'
        ? [hook.eventName]
        : [],
    );
    return supportsNativeHookEvents('codex', events);
  });
}
