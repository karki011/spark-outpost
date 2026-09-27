import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { createAcpProvider, primaryOnlyNote } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { decide, type ApprovalRequest } from '../src/approvals/decide.ts';
import type { GateAnswer, PermissionGate, ProviderOutput } from '../src/providers/provider.ts';

const launch = {
  command: process.execPath,
  args: ['--import', import.meta.resolve('tsx'), join(import.meta.dirname, 'fake-acp-agent.ts')],
};
const codex = createAcpProvider({
  definition: agentDefinitions.codex,
  launch,
  cancelGraceMs: 2_000,
});

let root: string;
let other: string;

beforeAll(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'spark-codex-do-')));
  root = join(base, 'app');
  other = join(base, 'lib');
  await mkdir(root);
  await mkdir(other);
  await writeFile(join(root, 'README.md'), '# app\n');
  await writeFile(join(root, '.env'), 'TOKEN=abc');
});

afterAll(async () => {
  await rm(join(root, '..'), { recursive: true, force: true });
});

interface Reviewed {
  request: ApprovalRequest;
  verdict: string;
}

function levelGate(level: InvolvementLevel, userAllows = true) {
  const reviewed: Reviewed[] = [];
  const pick = (request: ApprovalRequest, allowed: boolean): GateAnswer => {
    const kind = allowed ? 'allow_once' : 'reject_once';
    const option = request.options.find((candidate) => candidate.kind === kind)!;
    return {
      outcome: 'selected',
      optionId: option.optionId,
      allowed,
      note: `${kind} ${request.title}`,
    };
  };
  const stub: PermissionGate = {
    review: async (request) => {
      const decision = decide(level, request, [], []);
      reviewed.push({ request, verdict: decision.verdict });
      if (decision.verdict === 'allow') return pick(request, true);
      if (decision.verdict === 'reject') return pick(request, false);
      return pick(request, userAllows);
    },
  };
  return { stub, reviewed };
}

async function run(prompt: string, approvals: PermissionGate, projectRoots = [root]) {
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of codex.run({
      prompt,
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      projectRoots,
      signal: new AbortController().signal,
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
  const settings = outputs.find((output) => output.kind === 'session_settings');
  return { text, steps, error, settings };
}

const SCRIPT =
  '#codex ls -la;;cat README.md;;patch notes.txt;;echo hi > shell.txt;;cat .env;;pnpm add left-pad';

describe('Codex Do through the fake agent', () => {
  it('switches to the ask-every-action mode before prompting', async () => {
    const { stub } = levelGate('balanced');
    const result = await run('#codex ls', stub);
    expect(result.error).toBeNull();
    expect(result.settings).toMatchObject({ mode: 'ask-every-action' });
  });

  it.each([
    ['hands-on', ['ask', 'ask', 'ask', 'ask', 'ask', 'ask']],
    ['balanced', ['allow', 'allow', 'ask', 'ask', 'ask', 'ask']],
    ['hands-off', ['allow', 'allow', 'allow', 'ask', 'ask', 'ask']],
    ['full-auto', ['allow', 'allow', 'allow', 'allow', 'ask', 'ask']],
  ] as const)('sends every action to the gate at %s', async (level, verdicts) => {
    const { stub, reviewed } = levelGate(level);
    const result = await run(SCRIPT, stub);
    expect(result.error).toBeNull();
    expect(reviewed.map((entry) => entry.verdict)).toEqual(verdicts);
    expect(reviewed.map((entry) => entry.request.kind)).toEqual([
      'execute',
      'execute',
      'edit',
      'execute',
      'execute',
      'execute',
    ]);
    expect(result.text).toContain('[ls -la=allow_once]');
    expect(result.text).toContain('[pnpm add left-pad=allow_once]');
  });

  it('declines with the option that lets Codex continue', async () => {
    const { stub, reviewed } = levelGate('hands-on', false);
    const result = await run('#codex echo hi > a.txt;;patch b.txt;;ls', stub);
    expect(result.error).toBeNull();
    expect(reviewed).toHaveLength(3);
    expect(result.text).toContain('[echo hi > a.txt=decline]');
    expect(result.text).toContain('[patch b.txt=decline]');
    expect(result.text).toContain('[ls=decline]');
  });

  it('opens only the primary repo and says so', async () => {
    const { stub, reviewed } = levelGate('balanced');
    const result = await run('#codex ls;;cat ../lib/x.txt', stub, [root, other]);
    expect(result.steps).toContain(primaryOnlyNote(agentDefinitions.codex, root));
    expect(reviewed[0]!.request.roots.map((entry) => entry.path)).toEqual([root]);
    expect(reviewed.map((entry) => entry.verdict)).toEqual(['allow', 'ask']);
  });
});
