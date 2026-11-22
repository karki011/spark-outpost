import type { GitDirs } from '../projects/path-policy.ts';
import type { ApprovalRequest, RequestRoot } from './decide.ts';
import { toGatePath } from './gate-path.ts';

function gateGitDirs(dirs: GitDirs): GitDirs {
  return { ...dirs, common: toGatePath(dirs.common), own: toGatePath(dirs.own) };
}

function gateRoot(root: RequestRoot): RequestRoot {
  return {
    ...root,
    path: toGatePath(root.path),
    ...(root.gitDirs ? { gitDirs: gateGitDirs(root.gitDirs) } : {}),
  };
}

export function gateRequest(request: ApprovalRequest): ApprovalRequest {
  const paths = (list: readonly string[]) => list.map((item) => toGatePath(item));
  return {
    ...request,
    cwd: request.cwd === null ? null : toGatePath(request.cwd),
    paths: paths(request.paths),
    roots: request.roots.map(gateRoot),
    home: toGatePath(request.home),
    ...(request.attachedFiles ? { attachedFiles: paths(request.attachedFiles) } : {}),
    ...(request.readable ? { readable: paths(request.readable) } : {}),
  };
}
