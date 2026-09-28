import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { ApprovalRequest } from '../src/approvals/decide.ts';
import {
  type GateAnswer,
  type PermissionGate,
  type ProviderOutput,
} from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';

const launch = {
  command: process.execPath,
  args: [join(import.meta.dirname, 'fake-acp-agent.ts')],
};
const claude = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
});
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-acp-do-')));
  await writeFile(join(root, 'notes.txt'), 'before\n');
  await writeFile(join(root, '.env'), 'TOKEN=abc');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

type Answer = (request: ApprovalRequest, signal: AbortSignal) => Promise<GateAnswer>;

function gate(answer: Answer) {
  const requests: ApprovalRequest[] = [];
  const stub: PermissionGate = {
    review: (request, signal) => {
      requests.push(request);
      return answer(request, signal);
    },
  };
  return { stub, requests };
}

const allow: Answer = async (request) => ({
  outcome: 'selected',
  optionId: request.options.find((option) => option.kind === 'allow_once')!.optionId,
  allowed: true,
  note: 'Allowed it',
});

const deny: Answer = async (request) => ({
  outcome: 'selected',
  optionId: request.options.find((option) => option.kind === 'reject_once')!.optionId,
  allowed: false,
  note: 'Denied it',
});

async function run(
  prompt: string,
  approvals: PermissionGate,
  options: { provider?: typeof claude; controller?: AbortController } = {},
) {
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  const controller = options.controller ?? new AbortController();
  try {
    for await (const output of (options.provider ?? claude).run({
      prompt,
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      projectRoots: [root],
      signal: controller.signal,
      mode: 'do',
      approvals,
    })) {
      outputs.push(output);
    }
  } catch (caught) {
    error = caught;
  }
  const text = outputs.map((output) => (output.kind === 'text_delta' ? output.delta : '')).join('');
  const steps = outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));
  return { text, steps, error };
}

describe('ACP permission requests in Do mode', { timeout: 20_000 }, () => {
  it('sends the request to the gate and answers with the allowed option', async () => {
    const { stub, requests } = gate(allow);
    const result = await run('#write', stub);
    expect(result.text).toContain('permission=yes');
    expect(result.steps).toContain('Allowed it');
    expect(requests[0]).toMatchObject({
      toolCallId: 't1',
      kind: 'edit',
      title: 'Write notes.txt',
      options: [
        { optionId: 'yes', kind: 'allow_once' },
        { optionId: 'no', kind: 'reject_once' },
      ],
      roots: [{ path: root }],
    });
  });

  it('answers with the reject option when the gate denies', async () => {
    const { stub } = gate(deny);
    const result = await run('#write', stub);
    expect(result.text).toContain('permission=no');
    expect(result.steps).toContain('Denied it');
  });

  it('answers cancelled when the run is stopped while the gate waits', async () => {
    const controller = new AbortController();
    const answers: GateAnswer[] = [];
    const { stub } = gate(
      (_request, signal) =>
        new Promise((resolve) => {
          const cancelled: GateAnswer = { outcome: 'cancelled', note: 'Cancelled while waiting' };
          signal.addEventListener('abort', () => {
            answers.push(cancelled);
            resolve(cancelled);
          });
          setTimeout(() => controller.abort(), 50);
        }),
    );
    const result = await run('#write', stub, { controller });
    expect(answers).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it('advertises file writes only in Do mode', async () => {
    const { stub } = gate(allow);
    const result = await run('#caps', stub);
    expect(JSON.parse(result.text)).toMatchObject({
      fs: { readTextFile: true, writeTextFile: true },
    });
  });
});

describe('fs/write_text_file in Do mode', { timeout: 20_000 }, () => {
  it('asks the gate with a diff, then writes the file', async () => {
    const { stub, requests } = gate(allow);
    const target = join(root, 'notes.txt');
    const result = await run(`#fswrite ${target}`, stub);
    expect(result.text).toContain(`[write ${target}=ok:]`);
    expect(await readFile(target, 'utf8')).toBe('x');
    expect(requests[0]).toMatchObject({
      kind: 'edit',
      paths: [target],
      diffs: [{ path: target, oldText: 'before\n', newText: 'x' }],
    });
    await writeFile(target, 'before\n');
  });

  it('leaves the file alone when the gate denies', async () => {
    const { stub } = gate(deny);
    const target = join(root, 'notes.txt');
    const result = await run(`#fswrite ${target}`, stub);
    expect(result.text).toContain(`[write ${target}=err:-32600]`);
    expect(await readFile(target, 'utf8')).toBe('before\n');
  });

  it('answers request_cancelled when the write was cancelled while waiting', async () => {
    const { stub } = gate(async () => ({ outcome: 'cancelled', note: 'Cancelled it' }));
    const target = join(root, 'notes.txt');
    const result = await run(`#fswrite ${target}`, stub);
    expect(result.text).toContain(`[write ${target}=err:-32800]`);
    expect(await readFile(target, 'utf8')).toBe('before\n');
  });

  it('refuses secret files and paths outside the project before asking', async () => {
    const { stub, requests } = gate(allow);
    const result = await run(`#fswrite ${join(root, '.env')} #fswrite /tmp/elsewhere.txt`, stub);
    expect(result.text).toContain('.env=err:-32602');
    expect(result.text).toContain('/tmp/elsewhere.txt=err:-32602');
    expect(requests).toHaveLength(0);
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('TOKEN=abc');
  });
});
