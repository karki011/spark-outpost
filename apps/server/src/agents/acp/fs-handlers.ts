import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { FS_WRITE_TOOL_KIND, type ApprovalRequest } from '../../approvals/decide.ts';
import { readProjectText, resolveInProject } from '../../projects/project-fs.ts';
import {
  PROJECT_READ_MAX_BYTES,
  PathRefusedError,
  type PathPolicy,
  type ResolvedPath,
} from '../../projects/path-policy.ts';
import type { GateAnswer } from '../../providers/provider.ts';
import { ASK_MODE_REASON, NO_FOLDER_REASON } from './permissions.ts';

type Report = (name: string) => void;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function projectLabel(policy: PathPolicy, file: ResolvedPath): string {
  return policy.roots.length > 1 ? `${path.basename(file.root)}/${file.relative}` : file.relative;
}

export async function readTextFile(
  policy: PathPolicy,
  params: acp.ReadTextFileRequest,
  report: Report,
): Promise<acp.ReadTextFileResponse> {
  try {
    const file = await readProjectText(policy, params.path, params.line, params.limit);
    report(`Read \`${projectLabel(policy, file)}\``);
    return { content: file.content };
  } catch (error) {
    if (error instanceof PathRefusedError) {
      report(`Refused \`${params.path}\` (${error.reason})`);
      throw acp.RequestError.invalidParams({ path: params.path }, error.message);
    }
    if (isMissing(error)) throw acp.RequestError.resourceNotFound(params.path);
    throw acp.RequestError.internalError(undefined, 'The file could not be read.');
  }
}

export function refuseWrite(
  params: acp.WriteTextFileRequest,
  inProject: boolean,
  report: Report,
): never {
  const reason = inProject ? ASK_MODE_REASON : NO_FOLDER_REASON;
  report(`Declined: Write \`${params.path}\` (${reason})`);
  throw acp.RequestError.methodNotFound(acp.methods.client.fs.writeTextFile);
}

async function currentText(target: string): Promise<string | null> {
  try {
    const data = await readFile(target);
    return data.subarray(0, PROJECT_READ_MAX_BYTES).toString('utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export interface WriteContext {
  policy: PathPolicy;
  home: string;
  review: (request: ApprovalRequest) => Promise<GateAnswer>;
  report: Report;
  annotate: Report;
}

export async function writeTextFile(
  params: acp.WriteTextFileRequest,
  context: WriteContext,
): Promise<acp.WriteTextFileResponse> {
  const { policy, report } = context;
  let resolved: ResolvedPath;
  try {
    resolved = await resolveInProject(policy, params.path, 'write');
  } catch (error) {
    if (error instanceof PathRefusedError) {
      report(`Refused \`${params.path}\` (${error.reason})`);
      throw acp.RequestError.invalidParams({ path: params.path }, error.message);
    }
    throw error;
  }
  const target = resolved.absolute;
  const answer = await context.review({
    toolCallId: `fs:${target}`,
    rpcId: null,
    kind: 'edit',
    toolKind: FS_WRITE_TOOL_KIND,
    title: `Write ${projectLabel(policy, resolved)}`,
    command: null,
    cwd: null,
    paths: [target],
    diffs: [{ path: target, oldText: await currentText(target), newText: params.content }],
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
    ],
    roots: policy.roots,
    home: context.home,
  });
  context.annotate(answer.note);
  if (answer.outcome === 'cancelled') {
    throw acp.RequestError.requestCancelled({ path: params.path }, 'The turn was stopped.');
  }
  if (!answer.allowed) {
    throw acp.RequestError.invalidRequest(
      { path: params.path },
      'Declined: the write was not approved.',
    );
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, params.content);
  return {};
}
