import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeHookHost, type PermissionHandler } from './native-hook-host.ts';
import { nativeHookScript } from './native-hook-script.ts';

let folder: string;
let observed: unknown[];
let asked: unknown[];
let answer: PermissionHandler;
let host: Awaited<ReturnType<typeof nativeHookHost>>;

const request = {
  hook_event_name: 'PermissionRequest',
  session_id: 'native',
  tool_name: 'Bash',
  tool_input: { command: 'touch phone.txt', description: 'Create a file' },
};

async function config(extra: Record<string, unknown>): Promise<string> {
  const path = join(folder, `observer-${Math.random()}.json`);
  await writeFile(
    path,
    JSON.stringify({ url: host.url, token: 'good', sessionId: 's', provider: 'claude', ...extra }),
  );
  return path;
}

function start(configPath: string, stdin: object) {
  const child = spawn(process.execPath, [join(folder, 'observe.mjs'), configPath]);
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const done = new Promise<string>((resolve) => child.on('exit', () => resolve(output)));
  child.stdin.end(JSON.stringify(stdin));
  return { child, done };
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'spark-hook-permission-'));
  await writeFile(join(folder, 'observe.mjs'), nativeHookScript());
  observed = [];
  asked = [];
  answer = async () => null;
  host = await nativeHookHost(
    (token) => token === 'good',
    async (_token, body) => {
      observed.push(body);
      return true;
    },
    (token, body, signal) => {
      asked.push(body);
      return answer(token, body, signal);
    },
  );
});
afterEach(async () => {
  await host.close();
  await rm(folder, { recursive: true, force: true });
});

describe('a permission request from a Terminal session', () => {
  it('reports the event, then prints the decision a paired device gave', async () => {
    answer = async () => 'allow';
    const output = await start(await config({ permissionUrl: host.permissionUrl }), request).done;
    expect(observed).toHaveLength(1);
    expect(JSON.stringify(observed[0])).not.toContain('touch phone.txt');
    expect(asked).toEqual([{ tool: 'Bash', input: request.tool_input }]);
    expect(JSON.parse(output)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  });

  it('prints a denial with a reason the agent can read', async () => {
    answer = async () => 'deny';
    const output = await start(await config({ permissionUrl: host.permissionUrl }), request).done;
    expect(JSON.parse(output)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Denied from a paired device.' },
      },
    });
  });

  it('prints nothing when no decision comes, so the CLI asks on the Mac', async () => {
    const output = await start(await config({ permissionUrl: host.permissionUrl }), request).done;
    expect(output).toBe('');
    expect(asked).toHaveLength(1);
  });

  it('prints nothing and asks nothing when the session was started without the address', async () => {
    answer = async () => 'allow';
    const output = await start(await config({}), request).done;
    expect(output).toBe('');
    expect(asked).toEqual([]);
    expect(observed).toHaveLength(1);
  });

  it('lets the waiting request go when the CLI ends the hook', async () => {
    let released!: () => void;
    const gone = new Promise<void>((resolve) => (released = resolve));
    answer = (_token, _body, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          released();
          resolve(null);
        });
      });
    const { child } = start(await config({ permissionUrl: host.permissionUrl }), request);
    await waitFor(() => asked.length === 1);
    (child as ChildProcess).kill('SIGTERM');
    await gone;
  });

  it('waits only briefly for Codex, which hides its menu while a hook runs', async () => {
    answer = () => new Promise(() => undefined);
    const started = Date.now();
    const output = await start(
      await config({ permissionUrl: host.permissionUrl, provider: 'codex' }),
      request,
    ).done;
    expect(output).toBe('');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

async function waitFor(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !check(); tries++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
}
