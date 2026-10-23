import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { PermissionGate, ProviderOutput, ProviderTurn } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const SECRET = 'fake-token-4242-do-not-show';
const CODEX_MODES = ['read-only', 'ask-every-action', 'agent', 'agent-full-access'];

const codex = createAcpProvider({
  definition: agentDefinitions.codex,
  launch,
  env: {
    ...childEnvironment(process.env),
    FAKE_ACP_MODES: JSON.stringify(CODEX_MODES.map((mode) => [mode, mode, null, null])),
  },
  cancelGraceMs: 2_000,
});

const neverAsked: PermissionGate = {
  review: () => Promise.reject(new Error('no permission request expected')),
};

let root: string;
let data: string;
const savedData = process.env.SPARK_BROWSER_DATA_DIR;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-codex-secrets-')));
  data = await realpath(await mkdtemp(join(tmpdir(), 'spark-codex-data-')));
  process.env.SPARK_BROWSER_DATA_DIR = data;
  await mkdir(join(data, 'Partitions', 'spark-browser-personal'), { recursive: true });
  await writeFile(join(data, 'Partitions', 'spark-browser-personal', 'Cookies'), `${SECRET}\n`);
  await writeFile(join(data, 'postgres-password'), `${SECRET}\n`);
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'README.md'), '# app\n');
  await writeFile(join(root, '.env'), `MATHLIB_API_TOKEN=${SECRET}\n`);
  await writeFile(join(root, 'config', '.env.local'), `LOCAL=${SECRET}\n`);
  await writeFile(join(root, 'deploy.pem'), `${SECRET}\n`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
  if (savedData === undefined) delete process.env.SPARK_BROWSER_DATA_DIR;
  else process.env.SPARK_BROWSER_DATA_DIR = savedData;
});

async function reply(prompt: string, turn: Partial<ProviderTurn> = {}): Promise<string> {
  const outputs: ProviderOutput[] = [];
  for await (const output of codex.run({
    prompt,
    history: [],
    settings: { method: 'cli', model: null, modelLabel: null, effort: null },
    projectRoots: [root],
    signal: new AbortController().signal,
    ...turn,
  })) {
    outputs.push(output);
  }
  return replyText(outputs);
}

const READ_SECRETS =
  '#sandboxed cat README.md; cat .env; cat config/.env.local; ln -s .env e; cat e; cat deploy.pem';

describe.skipIf(process.platform !== 'darwin')(
  'Codex reading secret files in its sandbox',
  { timeout: 30_000 },
  () => {
    it('blocks a read-only Ask turn from reading .env and friends', async () => {
      const text = await reply(READ_SECRETS);
      expect(text).toContain('sandbox=read-only');
      expect(text).toContain('# app');
      expect(text).toContain('.env: Operation not permitted');
      expect(text).not.toContain(SECRET);
    });

    it.each(['ask-every-action', 'agent', 'agent-full-access'])(
      'blocks a Do turn in the %s mode, which the approval gate never sees',
      async (mode) => {
        const text = await reply(`${READ_SECRETS}; echo made > made.txt && cat made.txt`, {
          mode: 'do',
          settings: { method: 'cli', model: null, modelLabel: null, effort: null, mode },
          approvals: neverAsked,
        });
        expect(text).toContain(`sandbox=${mode}`);
        expect(text).toContain('# app');
        expect(text).toContain('made');
        expect(text).toContain('.env: Operation not permitted');
        expect(text).not.toContain(SECRET);
      },
    );

    it.each(CODEX_MODES)("blocks Spark's browser data in the %s mode", async (mode) => {
      const read = `#sandboxed cat "${data}/postgres-password"; cat "${data}/Partitions/spark-browser-personal/Cookies"; echo done`;
      const text = await reply(read, {
        mode: mode === 'read-only' ? 'ask' : 'do',
        settings: { method: 'cli', model: null, modelLabel: null, effort: null, mode },
        approvals: neverAsked,
      });
      expect(text).toContain(`sandbox=${mode}`);
      expect(text).toContain('postgres-password: Operation not permitted');
      expect(text).toContain('Cookies: Operation not permitted');
      expect(text).not.toContain(SECRET);
    });
  },
);
