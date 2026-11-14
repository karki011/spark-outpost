import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import { NO_RUN_RULES, decide } from '../src/approvals/decide.ts';
import type { PermissionGate, ProviderOutput, TurnAttachment } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const capabilities = { image: true, embeddedContext: true };
const env = {
  ...childEnvironment(process.env),
  FAKE_ACP_PROMPT_CAPABILITIES: JSON.stringify(capabilities),
};
const named = (base: AgentDefinition): AgentDefinition => ({
  ...base,
  name: 'Fake',
  ...FAKE_AGENT_MODES,
});
const claude = createAcpProvider({
  definition: named(agentDefinitions.claude),
  launch,
  env,
  cancelGraceMs: 2_000,
});
const codex = createAcpProvider({
  definition: named(agentDefinitions.codex),
  launch,
  env,
  cancelGraceMs: 2_000,
});

const pdf: TurnAttachment = {
  name: 'report.pdf',
  mediaType: 'application/pdf',
  kind: 'file',
  data: Buffer.from('%PDF-1.7 fake'),
};
const sheet: TurnAttachment = {
  name: 'q3 sheet.xlsx',
  mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  kind: 'file',
  data: Buffer.from('PK-sheet-bytes'),
};

interface Seen {
  texts: string[];
  resources: { uri: string; mimeType: string; blob: string | null }[];
  files: { path: string; content: string | null }[];
}

let base: string;
let project: string;
const originalTmpdir = process.env.TMPDIR;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-attach-test-')));
  project = join(base, 'app');
  await mkdir(project);
  await mkdir(join(base, 'scratch'));
  process.env.TMPDIR = join(base, 'scratch');
});

afterAll(async () => {
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  await rm(base, { recursive: true, force: true });
});

const attachmentFolders = () =>
  readdirSync(join(base, 'scratch')).filter((name) => name.startsWith('spark-attach-'));

async function run(
  provider: typeof claude,
  prompt: string,
  options: {
    roots?: string[];
    abortOnReply?: boolean;
    abortAtOnce?: boolean;
    approvals?: PermissionGate;
  } = {},
) {
  const controller = new AbortController();
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of provider.run({
      prompt,
      attachments: [pdf, sheet],
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      projectRoots: options.roots ?? [project],
      ...(options.approvals ? { approvals: options.approvals, mode: 'do' as const } : {}),
      signal: controller.signal,
    })) {
      outputs.push(output);
      if (options.abortAtOnce) controller.abort();
      if (options.abortOnReply && replyText(outputs).includes('"files"')) controller.abort();
    }
  } catch (caught) {
    error = caught;
  }
  const text = replyText(outputs);
  const seen = text.startsWith('{') ? (JSON.parse(text) as Seen) : null;
  return { seen, error, text };
}

describe('file attachments reaching an ACP agent', { timeout: 30_000 }, () => {
  it('sends a PDF as a blob to Claude, the spreadsheet by path, then removes the folder', async () => {
    const { seen, error } = await run(claude, '#blocks #files');
    expect(error).toBeNull();
    expect(seen!.resources).toEqual([
      {
        uri: 'attachment:///report.pdf',
        mimeType: 'application/pdf',
        blob: pdf.data.toString('base64'),
      },
    ]);
    expect(seen!.texts.some((text) => text.includes('[Attached PDF: report.pdf]'))).toBe(true);
    expect(seen!.files).toHaveLength(1);
    expect(seen!.files[0]).toEqual({
      path: expect.stringContaining('q3 sheet.xlsx'),
      content: 'PK-sheet-bytes',
    });
    expect(
      seen!.texts.some((text) => text.includes('Attached file "q3 sheet.xlsx" (application/vnd')),
    ).toBe(true);
    expect(attachmentFolders()).toEqual([]);
  });

  it('gives both files to a Codex agent by path and never sends it a PDF blob', async () => {
    const { seen, error } = await run(codex, '#blocks #files');
    expect(error).toBeNull();
    expect(seen!.resources).toEqual([]);
    expect(seen!.files.map((file) => file.content)).toEqual(['%PDF-1.7 fake', 'PK-sheet-bytes']);
    expect(attachmentFolders()).toEqual([]);
  });

  it('writes nothing when the turn has no folder to read files in', async () => {
    const { seen, error } = await run(codex, '#blocks #files', { roots: [] });
    expect(error).toBeNull();
    expect(seen!.files).toEqual([]);
    expect(seen!.texts.join('\n')).toContain(
      '[File not shown: report.pdf. This turn cannot open files.]',
    );
    expect(attachmentFolders()).toEqual([]);
  });

  it('sends no prompt when the run is stopped while the files are being prepared', async () => {
    const { seen, text } = await run(codex, '#blocks #files', { abortAtOnce: true });
    expect(seen).toBeNull();
    expect(text).toBe('');
    expect(attachmentFolders()).toEqual([]);
  });

  it('lets the gate allow a read of an attached file, like any read outside the project', async () => {
    const verdicts: string[] = [];
    const approvals: PermissionGate = {
      review: async (request) => {
        const beside = { ...request, paths: request.paths.map((path) => `${path}.other`) };
        verdicts.push(
          decide('full_access', request, NO_RUN_RULES, []).verdict,
          decide('full_access', beside, NO_RUN_RULES, []).verdict,
        );
        const allowed = verdicts.at(-2) === 'allow';
        return {
          outcome: 'selected',
          optionId: allowed ? 'yes' : 'no',
          allowed,
          note: allowed ? 'Allowed' : 'Refused',
        };
      },
    };
    const { seen, error } = await run(codex, '#blocks #files #askread', { approvals });
    expect(error).toBeNull();
    expect(verdicts).toEqual(['allow', 'allow', 'allow', 'allow']);
    expect(seen!.files.map((file) => file.content)).toEqual(['%PDF-1.7 fake', 'PK-sheet-bytes']);
    expect(attachmentFolders()).toEqual([]);
  });

  it('removes the folder when the run is cancelled', async () => {
    const { seen } = await run(codex, '#blocks #files #stall', { abortOnReply: true });
    expect(seen?.files.map((file) => file.content) ?? []).toEqual([
      '%PDF-1.7 fake',
      'PK-sheet-bytes',
    ]);
    expect(attachmentFolders()).toEqual([]);
  });
});
