import type { RailKind } from '@spark-outpost/contracts';
import { guardedTargets, secretLabels, type ApprovalRequest } from './decide.ts';
import { diskFiles, type FileLister } from './file-lister.ts';
import { withPrefetchedFiles } from './prefetched-files.ts';
import { forcePush } from './git-commands.ts';
import { alwaysAsk, type RailAsk } from './rails.ts';
import type { ShellScript } from './shell-parse.ts';
import { shellView, type ShellView } from './shell-view.ts';

export interface RailCrossing {
  rail: RailKind;
  paths: string[];
}

export interface CrossingOptions {
  shell?: ShellScript | null;
  defaultBranch?: string | null;
  files?: FileLister;
}

async function askedRail(
  request: ApprovalRequest,
  options: CrossingOptions,
  view: ShellView | null,
): Promise<RailAsk | null> {
  if (options.files) return alwaysAsk(request, options.files, view);
  return withPrefetchedFiles(diskFiles, (files) => alwaysAsk(request, files, view), null);
}

async function reasonCrossing(
  request: ApprovalRequest,
  options: CrossingOptions,
): Promise<RailCrossing | null> {
  const view = shellView(request, options.shell ?? null);
  const asked = await askedRail(request, options, view);
  if (!asked) return null;
  return { rail: asked.rail, paths: asked.rail === 'secret' ? secretLabels(request) : asked.paths };
}

export async function railCrossings(
  request: ApprovalRequest,
  options: CrossingOptions = {},
): Promise<RailCrossing[]> {
  const crossings: RailCrossing[] = [];
  const reasoned = await reasonCrossing(request, options);
  if (reasoned) crossings.push(reasoned);
  const guarded = guardedTargets(request);
  if (guarded.instructions.length > 0) {
    crossings.push({ rail: 'instructions', paths: guarded.instructions });
  }
  if (guarded.gitControl.length > 0) {
    crossings.push({ rail: 'git_control', paths: guarded.gitControl });
  }
  const forced = request.command ? forcePush(request.command, options.defaultBranch ?? null) : null;
  if (forced) {
    crossings.push({ rail: 'force_push', paths: forced.kind === 'ask' ? forced.branches : [] });
  }
  return crossings;
}
