import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAcpProvider, noFolderAccessNote } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import { ProviderError, type Provider, type ProviderOutput } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const definition: AgentDefinition = {
  ...agentDefinitions.claude,
  name: 'Fake',
  ...FAKE_AGENT_MODES,
};
const provider = createAcpProvider({ definition, launch, cancelGraceMs: 2_000 });
const advertisingDirectories = {
  ...childEnvironment(process.env),
  FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ additionalDirectories: {} }),
};
const providerWithDirectories = createAcpProvider({
  definition,
  launch,
  cancelGraceMs: 2_000,
  env: advertisingDirectories,
});
const codex = createAcpProvider({
  definition: agentDefinitions.codex,
  launch,
  cancelGraceMs: 2_000,
  env: advertisingDirectories,
});

let base: string;
let root: string;
let lib: string;
const originalTmpdir = process.env.TMPDIR;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-acp-project-')));
  root = join(base, 'app');
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'README.md'), 'line one\nline two\nline three\n');
  await writeFile(join(root, '.env'), 'TOKEN=abc');
  await writeFile(join(root, '.sparkignore'), 'private/\n');
  await mkdir(join(root, 'private'));
  await writeFile(join(root, 'private', 'notes.md'), 'kept away');
  await writeFile(join(base, 'outside.txt'), 'nope');
  await symlink(join(base, 'outside.txt'), join(root, 'docs', 'escape.txt'));
  lib = join(base, 'lib');
  await mkdir(lib);
  await writeFile(join(lib, 'README.md'), 'library readme');
  await writeFile(join(lib, '.env'), 'LIB_TOKEN=abc');
  await mkdir(join(base, 'scratch'));
  process.env.TMPDIR = join(base, 'scratch');
});

afterAll(async () => {
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  await rm(base, { recursive: true, force: true });
});

async function collect(prompt: string, projectRoot: string | null, extra: string[] = []) {
  return collectFrom(provider, prompt, projectRoot ? [projectRoot, ...extra] : []);
}

async function collectFrom(agent: Provider, prompt: string, projectRoots: string[]) {
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of agent.run({
      prompt,
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      projectRoots,
      signal: new AbortController().signal,
    })) {
      outputs.push(output);
    }
  } catch (caught) {
    error = caught;
  }
  const text = replyText(outputs);
  const steps = outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));
  const secretReads = outputs.flatMap((output) =>
    output.kind === 'secret_read' ? output.paths : [],
  );
  return { text, steps, error, secretReads };
}

describe('ACP provider in a project folder', { timeout: 20_000 }, () => {
  it('runs the agent in the project root and advertises file reads', async () => {
    const cwd = await collect('#cwd', root);
    expect(cwd.error).toBeNull();
    expect(cwd.text).toBe(`cwd=${root} process=${root}`);
    const runFolders = readdirSync(join(base, 'scratch')).filter((name) =>
      name.startsWith('spark-outpost-run-'),
    );
    expect(runFolders).toEqual([]);
    const caps = await collect('#caps', root);
    expect(JSON.parse(caps.text.split('\n')[0]!)).toMatchObject({
      fs: { readTextFile: true, writeTextFile: false },
    });
  });

  it('serves reads inside the root through the path policy, honouring line and limit', async () => {
    const readme = join(root, 'README.md');
    const { text, steps, error } = await collect(`#read ${readme} #read ${readme} 2 1`, root);
    expect(error).toBeNull();
    expect(text).toContain(`[${readme}=ok:line one\nline two\nline three\n]`);
    expect(text).toContain(`[${readme}=ok:line two]`);
    expect(steps.filter((step) => step === 'Read `README.md`')).toHaveLength(2);
  });

  it('refuses reads outside the root, through symlinks, and of .sparkignore files', async () => {
    const outside = join(root, '..', 'outside.txt');
    const escape = join(root, 'docs', 'escape.txt');
    const ignored = join(root, 'private', 'notes.md');
    const { text, steps, secretReads } = await collect(
      `#read ${outside} #read ${escape} #read ${ignored} #read ${join(root, 'missing.md')}`,
      root,
    );
    expect(text).toContain(`[${outside}=err:-32602]`);
    expect(text).toContain(`[${escape}=err:-32602]`);
    expect(text).toContain(`[${ignored}=err:-32602]`);
    expect(text).toContain(`[${join(root, 'missing.md')}=err:-32002]`);
    expect(steps).toEqual(
      expect.arrayContaining([
        `Refused \`${outside}\` (outside the project)`,
        `Refused \`${escape}\` (outside the project)`,
        `Refused \`${ignored}\` (secret file)`,
      ]),
    );
    expect(text).not.toContain('nope');
    expect(text).not.toContain('kept away');
    expect(secretReads).toEqual([]);
  });

  it('serves a read of a secret file and notes it by path', async () => {
    const secret = join(root, '.env');
    const readme = join(root, 'README.md');
    const { text, steps, secretReads } = await collect(`#read ${secret} #read ${readme}`, root);
    expect(text).toContain(`[${secret}=ok:TOKEN=abc]`);
    expect(steps).toContain('Read `.env`');
    expect(secretReads).toEqual(['.env']);
  });

  it('declines writes with a hint to switch to Do', async () => {
    const target = join(root, 'notes.txt');
    const { text, steps } = await collect(`#fswrite ${target}`, root);
    expect(text).toContain(`[write ${target}=err:-32601]`);
    expect(steps).toContain(
      `Declined: Write \`${target}\` (Ask mode doesn't change files — ask for the change in a message, or switch the agent's mode)`,
    );
    const permission = await collect('#write', root);
    expect(permission.text).toContain('permission=no');
    expect(permission.steps).toContain(
      "Declined: Write notes.txt (Ask mode doesn't change files — ask for the change in a message, or switch the agent's mode)",
    );
  });

  it('keeps file reads unavailable in chats without a project', async () => {
    const caps = await collect('#caps', null);
    expect(JSON.parse(caps.text.split('\n')[0]!)).toMatchObject({
      fs: { readTextFile: false, writeTextFile: false },
    });
    const { text, steps } = await collect(`#read ${join(root, 'README.md')}`, null);
    expect(text).toContain('=err:-32601]');
    expect(steps.some((step) => step.startsWith('Read '))).toBe(false);
  });

  it('fails clearly when the project folder is gone', async () => {
    const { error } = await collect('Hi', join(base, 'deleted'));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toMatch(/can't open the project folder/);
  });
});

describe('ACP provider with several linked repos', { timeout: 20_000 }, () => {
  it('sends extra repos as additionalDirectories when the agent advertises them', async () => {
    const { text, steps, error } = await collectFrom(providerWithDirectories, '#cwd', [root, lib]);
    expect(error).toBeNull();
    expect(text).toBe(`cwd=${root} process=${root}`);
    const dirs = await collectFrom(providerWithDirectories, '#dirs', [root, lib]);
    expect(dirs.text).toBe(`dirs=${JSON.stringify([lib])}`);
    expect(steps.some((step) => step.includes('only open one repo'))).toBe(false);
  });

  it('keeps one repo and explains why when the agent lacks the capability', async () => {
    const { text, steps } = await collect('#dirs', root, [lib]);
    expect(text).toBe('dirs=null');
    expect(steps).toContain('Fake can only open one repo per chat; using app');
  });

  it('serves reads in every linked repo, secret files included', async () => {
    const readme = join(lib, 'README.md');
    const secret = join(lib, '.env');
    const { text, steps, secretReads } = await collect(`#read ${readme} #read ${secret}`, root, [
      lib,
    ]);
    expect(text).toContain(`[${readme}=ok:library readme]`);
    expect(text).toContain(`[${secret}=ok:LIB_TOKEN=abc]`);
    expect(steps).toContain('Read `lib/README.md`');
    expect(steps).toContain('Read `lib/.env`');
    expect(secretReads).toEqual(['.env']);
  });

  it('names the missing repo when one of several is gone', async () => {
    const { error } = await collect('Hi', root, [join(base, 'gone')]);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toContain(join(base, 'gone'));
  });
});

describe('Codex with linked repos', { timeout: 20_000 }, () => {
  it('starts in the primary repo in read-only mode and gets the others as directories', async () => {
    const cwd = await collectFrom(codex, '#cwd', [root, lib]);
    expect(cwd.error).toBeNull();
    const [session, processCwd] = cwd.text.replace('cwd=', '').split(' process=');
    expect(session).toBe(root);
    expect(processCwd).toBe(root);
    expect(cwd.steps).not.toContain(noFolderAccessNote(agentDefinitions.codex));
    expect((await collectFrom(codex, '#dirs', [root, lib])).text).toBe(
      `dirs=${JSON.stringify([lib])}`,
    );
  });
});
