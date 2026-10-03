import { commandTree } from './command-tree.ts';
import { programName } from './commands.ts';
import { isPackageInstall } from './command-kinds.ts';
import { publishesCode, writesRepo } from './git-commands.ts';
import { writeTargets } from './write-targets.ts';

export const ASK_RUN_REASON = "Ask mode doesn't change files — use Make the change";

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

export function askRunRefusal(request: AskRunRequest, cwd: string, home: string): string | null {
  if (request.kind === 'edit' || request.toolKind === 'move' || request.toolKind === 'delete') {
    return ASK_RUN_REASON;
  }
  if (request.command && commandChangesFiles(request.command, cwd, home)) return ASK_RUN_REASON;
  return null;
}
