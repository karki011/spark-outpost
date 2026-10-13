import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeHookScript } from './native-hook-script.ts';

let folder: string;
let server: Server;
let received: { payload: Record<string, unknown> }[];
let answer: 'accept' | 'hang';

async function configFor(url: string): Promise<string> {
  const path = join(folder, `observer-${received.length}-${Math.random()}.json`);
  await writeFile(path, JSON.stringify({ url, token: 't', sessionId: 's', provider: 'claude' }));
  return path;
}

function run(config: string, stdin: string) {
  const started = Date.now();
  return new Promise<{ code: number | null; output: string; ms: number }>((resolve) => {
    const child = spawn(process.execPath, [join(folder, 'observe.mjs'), config]);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('exit', (code) => resolve({ code, output, ms: Date.now() - started }));
    child.stdin.end(stdin);
  });
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'spark-hook-script-'));
  await writeFile(join(folder, 'observe.mjs'), nativeHookScript());
  received = [];
  answer = 'accept';
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString()) as (typeof received)[number]);
      if (answer === 'accept') res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(folder, { recursive: true, force: true });
});

const url = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`;
const tool = {
  hook_event_name: 'PreToolUse',
  session_id: 'native',
  prompt_id: 'p1',
  tool_name: 'Bash',
  tool_use_id: 'toolu_1',
  agent_id: 'agent-1',
  model: 'gpt-x',
  transcript_path: '/home/native.jsonl',
};

describe('native hook script', () => {
  it('forwards the ids of a tool call and never its input, its result or the working folder', async () => {
    const result = await run(
      await configFor(url()),
      JSON.stringify({
        ...tool,
        cwd: '/secret/folder',
        tool_input: { command: 'cat .env' },
        tool_response: 'x'.repeat(200_000),
      }),
    );
    expect(result).toMatchObject({ code: 0, output: '' });
    expect(received.map((event) => event.payload)).toEqual([
      Object.fromEntries(Object.entries(tool).sort()),
    ]);
  });

  it('leaves out a new field of an unexpected shape and still reports the event', async () => {
    await run(
      await configFor(url()),
      JSON.stringify({
        ...tool,
        model: { id: 'gpt-x' },
        agent_id: 'a'.repeat(201),
        tool_use_id: 7,
      }),
    );
    expect(received.map((event) => event.payload)).toEqual([
      {
        hook_event_name: 'PreToolUse',
        session_id: 'native',
        prompt_id: 'p1',
        tool_name: 'Bash',
        transcript_path: '/home/native.jsonl',
      },
    ]);
  });

  it('is silent and quick when Spark is not there, the input is not JSON or the reply never comes', async () => {
    const config = await configFor('http://127.0.0.1:9/events');
    expect(await run(config, JSON.stringify(tool))).toMatchObject({ code: 0, output: '' });
    expect(await run(await configFor(url()), 'not json')).toMatchObject({ code: 0, output: '' });
    expect(await run(join(folder, 'missing.json'), '{}')).toMatchObject({ code: 0, output: '' });
    answer = 'hang';
    const hung = await run(await configFor(url()), JSON.stringify(tool));
    expect(hung).toMatchObject({ code: 0, output: '' });
    expect(hung.ms).toBeLessThan(2900);
  });
});
