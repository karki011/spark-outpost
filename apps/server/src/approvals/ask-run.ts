import type { ApprovalRequest, RequestRoot } from './decide.ts';
import { place } from './request-place.ts';
import { commandTree } from './command-tree.ts';
import { programName } from './commands.ts';
import { isPackageInstall } from './command-kinds.ts';
import { gitConfigUses, publishesCode, writesRepo } from './git-commands.ts';
import { partRequests, type ShellView } from './shell-view.ts';
import { writeTargets } from './write-targets.ts';

export const ASK_RUN_REASON =
  "Ask mode doesn't change files — ask for the change in a message, or switch the agent's mode";

export const WORK_RUN_REASON =
  'A Spark working in this chat never pushes, opens or changes a pull request, writes to GitHub or changes remotes or git config. Leave the commits on the branch and say what is ready to publish';

const FILE_CHANGERS = new Set(['mkdir', 'ln', 'chmod', 'chown', 'patch', 'dd', 'rsync']);

interface AskRunRequest {
  kind: string;
  toolKind: string | null;
  command: string | null;
}

function commandChangesFiles(command: string, cwd: string, home: string): boolean {
  if (publishesCode(command) || writesRepo(command) || isPackageInstall(command)) return true;
  const tree = commandTree(command);
  if (tree.commands.some((program) => FILE_CHANGERS.has(programName(program)))) return true;
  const targets = writeTargets(command, cwd, home);
  return targets === null ? !tree.opaque : targets.length > 0;
}

interface StepEditRequest {
  kind: string;
  toolKind: string | null;
  paths: readonly string[];
  roots: readonly RequestRoot[];
}

export function stepEditInside(request: StepEditRequest): boolean {
  if (request.kind !== 'edit' || request.toolKind === 'move' || request.toolKind === 'delete') {
    return false;
  }
  if (request.paths.length === 0) return false;
  return request.paths.every((target) => place(request.roots, target).relative !== null);
}

export function askRunRefusal(request: AskRunRequest, cwd: string, home: string): string | null {
  if (request.kind === 'edit' || request.toolKind === 'move' || request.toolKind === 'delete') {
    return ASK_RUN_REASON;
  }
  if (request.command && commandChangesFiles(request.command, cwd, home)) return ASK_RUN_REASON;
  return null;
}

export function workRunRefusal(request: Pick<AskRunRequest, 'command'>): string | null {
  const { command } = request;
  if (!command) return null;
  const changesRemotes = gitConfigUses(command).some((use) => use.writes);
  return publishesCode(command) || changesRemotes ? WORK_RUN_REASON : null;
}

export function workRunChange(request: ApprovalRequest, view: ShellView | null): string | null {
  const parts = view ? [request, ...partRequests(request, view)] : [request];
  return parts.some((part) => workRunRefusal(part) !== null) ? WORK_RUN_REASON : null;
}
