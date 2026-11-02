import { commandTree } from './command-tree.ts';
import type { ApprovalRequest } from './decide.ts';
import { namedSecrets, UNNAMED_SECRET } from './guarded-targets.ts';
import { diskFiles, type FileLister } from './file-lister.ts';
import { readConcern } from './file-reads.ts';
import { withPrefetchedFiles } from './prefetched-files.ts';
import { readsWithoutChanging } from './rails.ts';
import { commandCwd, isReadableSecret, placedLabel } from './request-place.ts';
import type { ShellScript } from './shell-parse.ts';
import { withResolvedVariables } from './shell-variables.ts';
import { shellView } from './shell-view.ts';

function secretsWalked(request: ApprovalRequest, files: FileLister): string[] | null {
  if (!request.command) return null;
  const found: string[] = [];
  const concern = readConcern(request.command, commandTree(request.command), {
    cwd: commandCwd(request),
    home: request.home,
    isSecret: (target) => {
      const secret = isReadableSecret(request.roots, target);
      if (secret) found.push(target);
      return secret;
    },
    readAsks: () => false,
    files,
  });
  if (concern !== 'secret' && concern !== 'secret_read') return null;
  return [...new Set(found.map((target) => placedLabel(request.roots, request.home, target)))];
}

function codeReadLabels(request: ApprovalRequest, files: FileLister): string[] {
  const walked = secretsWalked(request, files);
  if (!walked) return [];
  return walked.length > 0 ? walked : [UNNAMED_SECRET];
}

export function secretReadLabels(
  asked: ApprovalRequest,
  files: FileLister,
  shell: ShellScript | null,
): string[] {
  const request = withResolvedVariables(asked);
  if (!readsWithoutChanging(request, shellView(request, shell))) {
    return codeReadLabels(request, files);
  }
  const named = namedSecrets(request, (target) => isReadableSecret(request.roots, target));
  if (named.length > 0) return named;
  return secretsWalked(request, files) ? [UNNAMED_SECRET] : [];
}

export function observedSecretReads(
  request: ApprovalRequest,
  shell: ShellScript | null,
): Promise<string[]> {
  return withPrefetchedFiles(diskFiles, (files) => secretReadLabels(request, files, shell), []);
}
