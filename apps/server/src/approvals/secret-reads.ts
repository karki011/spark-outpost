import { commandTree } from './command-tree.ts';
import { namedSecrets, UNNAMED_SECRET, type ApprovalRequest } from './decide.ts';
import { diskFiles, type FileLister } from './file-lister.ts';
import { readConcern } from './file-reads.ts';
import { withPrefetchedFiles } from './prefetched-files.ts';
import { readsWithoutChanging } from './rails.ts';
import { commandCwd, isReadableSecret } from './request-place.ts';
import type { ShellScript } from './shell-parse.ts';
import { withResolvedVariables } from './shell-variables.ts';
import { shellView } from './shell-view.ts';

function walksSecret(request: ApprovalRequest, files: FileLister): boolean {
  if (!request.command) return false;
  const concern = readConcern(request.command, commandTree(request.command), {
    cwd: commandCwd(request),
    home: request.home,
    isSecret: (target) => isReadableSecret(request.roots, target),
    files,
  });
  return concern === 'secret';
}

export function secretReadLabels(
  asked: ApprovalRequest,
  files: FileLister,
  shell: ShellScript | null,
): string[] {
  const request = withResolvedVariables(asked);
  if (!readsWithoutChanging(request, shellView(request, shell))) return [];
  const named = namedSecrets(request, (target) => isReadableSecret(request.roots, target));
  if (named.length > 0) return named;
  return walksSecret(request, files) ? [UNNAMED_SECRET] : [];
}

export function observedSecretReads(
  request: ApprovalRequest,
  shell: ShellScript | null,
): Promise<string[]> {
  return withPrefetchedFiles(diskFiles, (files) => secretReadLabels(request, files, shell), []);
}
