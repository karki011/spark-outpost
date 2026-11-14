import path from 'node:path';
import { isSecretPath } from '../projects/path-policy.ts';
import { commandTree, deleteTargets, treeWords, type CommandTree } from './command-tree.ts';
import { resolveCommandPath } from './commands.ts';
import type { ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { readConcern } from './file-reads.ts';
import { worktreeAdds, worktreeRemoves } from './git-worktrees.ts';
import {
  commandCwd,
  homeRelative,
  isSecretTarget,
  outsideRoots,
  placedLabel,
  secretReadAsks,
} from './request-place.ts';
import { changesNothing, partRequests, type ShellView } from './shell-view.ts';
import { inTempDir } from './temp-dirs.ts';
import { writeTargets } from './write-targets.ts';

export const OUTSIDE_DELETE_REASON = 'Deleting outside the repo always asks';
export const OUTSIDE_WRITE_REASON = 'Changing files outside the repo always asks';
export const SECRET_REASON =
  'Changing a secret file always asks, and so does reading one listed in .sparkignore';

export interface RailAsk {
  rail: 'outside_delete' | 'outside_write' | 'secret';
  reason: string;
  paths: string[];
}

export type RailRuleId = 'WriteOutside' | 'SecretFile(edit)' | 'SecretFile(read)';
export type RailsWanted = (rule: RailRuleId) => boolean;

export const EVERY_RAIL: RailsWanted = () => true;

export function railRule(rail: RailAsk['rail'], reading: boolean): RailRuleId {
  if (rail !== 'secret') return 'WriteOutside';
  return reading ? 'SecretFile(read)' : 'SecretFile(edit)';
}

const SHOWN_PATHS = 2;

function shortList(names: readonly string[]): string {
  const first = names.slice(0, SHOWN_PATHS);
  const more = names.length - first.length;
  return more > 0 ? `${first.join(', ')} and ${more} more` : first.join(', ');
}

function listed(paths: readonly string[], home: string): string {
  return shortList(paths.map((target) => homeRelative(target, home)));
}

export function outsideDeleteReason(paths: readonly string[], home: string): string {
  return `This deletes ${listed(paths, home)}, which is outside this project`;
}

export function outsideWriteReason(paths: readonly string[], home: string): string {
  return `This changes ${listed(paths, home)}, which is outside this project`;
}

function leavesProject(request: ApprovalRequest, target: string): boolean {
  return outsideRoots(request, target) && !inTempDir(target);
}

function unique(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function outsideDeletes(request: ApprovalRequest, tree: CommandTree | null): string[] | null {
  const named = request.toolKind === 'delete' ? request.paths : [];
  if (!tree || !request.command) return named.filter((target) => leavesProject(request, target));
  const cwd = commandCwd(request);
  const deleted = deleteTargets(tree, cwd, request.home);
  const removed = worktreeRemoves(request.command, cwd, request.home);
  if (deleted === null || removed === null) return null;
  return unique([...named, ...deleted, ...removed]).filter((target) =>
    leavesProject(request, target),
  );
}

function outsideWrites(request: ApprovalRequest): string[] | null {
  if (!request.command) return [];
  const cwd = commandCwd(request);
  const added = worktreeAdds(request.command, cwd, request.home);
  if (added === null) return null;
  const written = writeTargets(request.command, cwd, request.home) ?? [];
  return unique([...written, ...added]).filter((target) => leavesProject(request, target));
}

const READ_TOOL_KINDS = new Set(['read', 'search']);

export function readsWithoutChanging(request: ApprovalRequest, view: ShellView | null): boolean {
  if (request.command) return changesNothing(request, view);
  return request.kind === 'other' && READ_TOOL_KINDS.has(request.toolKind ?? '');
}

type SecretTest = (target: string) => boolean;

function secretAsks(request: ApprovalRequest, reading: boolean): SecretTest {
  return reading
    ? (target) => secretReadAsks(request.roots, target)
    : (target) => isSecretTarget(request.roots, target);
}

function secretTargets(
  request: ApprovalRequest,
  tree: CommandTree | null,
  reading: boolean,
): string[] {
  const asks = secretAsks(request, reading);
  const named = request.paths.filter(asks);
  if (!tree) return named;
  const cwd = commandCwd(request);
  const words = treeWords(tree)
    .filter((word) => word !== '' && !word.startsWith('-') && !word.startsWith('!'))
    .flatMap((word) => {
      const target = resolveCommandPath(word, cwd, request.home);
      const secret = (!reading && isSecretPath(path.basename(word))) || asks(target);
      if (!secret) return [];
      if (!CODE_WORD.test(word)) return [target];
      const quoted = quotedSecrets(word, (literal) => {
        const inner = resolveCommandPath(literal, cwd, request.home);
        return (!reading && isSecretPath(path.basename(literal))) || asks(inner) ? inner : null;
      });
      return quoted.length > 0 ? quoted : [target];
    });
  return unique([...named, ...words]);
}

const CODE_WORD = /['"()\s]/;
const QUOTED_LITERAL = /(['"])([^'"\n]+)\1/g;

function quotedSecrets(word: string, secretTarget: (literal: string) => string | null): string[] {
  return [...word.matchAll(QUOTED_LITERAL)].flatMap(([, , literal]) => {
    const target = secretTarget(literal!);
    return target ? [target] : [];
  });
}

interface SecretsFound {
  targets: string[];
  inCode: boolean;
}

function secretsReached(
  request: ApprovalRequest,
  tree: CommandTree | null,
  files: FileLister,
  reading: boolean,
): SecretsFound | null {
  if (!request.command || !tree) return null;
  const reached: string[] = [];
  const inCode: string[] = [];
  const asks = secretAsks(request, reading);
  const concern = readConcern(request.command, tree, {
    cwd: commandCwd(request),
    home: request.home,
    isSecret: (target) => {
      const secret = asks(target);
      if (secret) reached.push(target);
      return secret;
    },
    readAsks: (target) => secretReadAsks(request.roots, target),
    files,
    inCode: (targets) => inCode.push(...targets),
  });
  if (concern !== 'secret') return null;
  return inCode.length > 0
    ? { targets: unique(inCode), inCode: true }
    : { targets: unique(reached), inCode: false };
}

const SECRET_ASK: RailAsk = { rail: 'secret', reason: SECRET_REASON, paths: [] };
const TOOL_CHANGES = new Set(['delete', 'move']);

function changedTargets(request: ApprovalRequest, tree: CommandTree | null): string[] {
  if (!request.command || !tree) {
    return request.kind === 'edit' || TOOL_CHANGES.has(request.toolKind ?? '') ? request.paths : [];
  }
  const cwd = commandCwd(request);
  return [
    ...(writeTargets(request.command, cwd, request.home) ?? []),
    ...(deleteTargets(tree, cwd, request.home) ?? []),
  ];
}

type SecretUse = 'changes' | 'reads' | 'uses' | 'runs';

function secretReason(names: string, count: number, use: SecretUse, ignored: boolean): string {
  const kind = count > 1 ? 'secret files' : 'a secret file';
  if (use === 'changes') return `This changes ${names}, ${kind}`;
  if (use === 'runs' && ignored)
    return `This runs code that reads ${names}, which .sparkignore lists`;
  if (use === 'runs')
    return `This runs code that uses ${names}, ${kind}, and does more than read it`;
  if (ignored) return `This ${use} ${names}, which .sparkignore lists`;
  return `This uses ${names}, ${kind}, in a command that does more than read it`;
}

function secretAsk(
  request: ApprovalRequest,
  tree: CommandTree | null,
  targets: readonly string[],
  reading: boolean,
  inCode = false,
): RailAsk {
  if (targets.length === 0) return SECRET_ASK;
  const changed = changedTargets(request, tree);
  const changes = targets.some((target) => changed.includes(target));
  const use = changes ? 'changes' : inCode ? 'runs' : reading ? 'reads' : 'uses';
  const ignored = targets.every((target) => secretReadAsks(request.roots, target));
  const labels = unique(targets.map((target) => placedLabel(request.roots, request.home, target)));
  const reason = secretReason(shortList(labels), labels.length, use, ignored);
  return { rail: 'secret', reason, paths: [...targets] };
}

function commandRail(
  request: ApprovalRequest,
  files: FileLister,
  reading: boolean,
  wanted: RailsWanted,
): RailAsk | null {
  const tree = request.command ? commandTree(request.command) : null;
  const secrets = wanted(railRule('secret', reading));
  if (!wanted('WriteOutside')) return secrets ? secretRail(request, tree, files, reading) : null;
  const deleted = outsideDeletes(request, tree);
  if (deleted === null) return { rail: 'outside_delete', reason: OUTSIDE_DELETE_REASON, paths: [] };
  if (deleted.length > 0) {
    const reason = outsideDeleteReason(deleted, request.home);
    return { rail: 'outside_delete', reason, paths: deleted };
  }
  const secret = secrets ? secretRail(request, tree, files, reading) : null;
  if (secret) return secret;
  const written = outsideWrites(request);
  if (written === null) return { rail: 'outside_write', reason: OUTSIDE_WRITE_REASON, paths: [] };
  if (written.length === 0) return null;
  const reason = outsideWriteReason(written, request.home);
  return { rail: 'outside_write', reason, paths: written };
}

function secretRail(
  request: ApprovalRequest,
  tree: CommandTree | null,
  files: FileLister,
  reading: boolean,
): RailAsk | null {
  const secrets = secretTargets(request, tree, reading);
  if (secrets.length > 0) return secretAsk(request, tree, secrets, reading);
  const reached = secretsReached(request, tree, files, reading);
  return reached ? secretAsk(request, tree, reached.targets, reading, reached.inCode) : null;
}

function redirectRail(
  view: ShellView | null,
  reading: boolean,
  wanted: RailsWanted,
): RailAsk | null {
  const kinds = view?.redirects ?? [];
  if (kinds.includes('secret') && wanted(railRule('secret', reading))) return SECRET_ASK;
  if (!kinds.includes('writes_outside') || !wanted('WriteOutside')) return null;
  return { rail: 'outside_write', reason: OUTSIDE_WRITE_REASON, paths: [] };
}

function editRail(request: ApprovalRequest, wanted: RailsWanted): RailAsk | null {
  if (!wanted('WriteOutside')) return null;
  if (request.kind !== 'edit' && request.toolKind !== 'move') return null;
  const outside = request.paths.filter((target) => leavesProject(request, target));
  if (outside.length === 0) return null;
  const reason = outsideWriteReason(outside, request.home);
  return { rail: 'outside_write', reason, paths: outside };
}

export interface RailFound extends RailAsk {
  rule: RailRuleId;
}

export function alwaysAsk(
  request: ApprovalRequest,
  files: FileLister,
  view: ShellView | null,
  wanted: RailsWanted = EVERY_RAIL,
  writesGranted = false,
): RailFound | null {
  const parts = view ? [request, ...partRequests(request, view)] : [request];
  const reading = readsWithoutChanging(request, view);
  const kept = (asked: RailAsk | null) =>
    asked && !(writesGranted && asked.rail === 'outside_write') ? asked : null;
  const found = (asked: RailAsk | null) =>
    asked ? { ...asked, rule: railRule(asked.rail, reading) } : null;
  for (const part of parts) {
    const asked = kept(commandRail(part, files, reading, wanted));
    if (asked) return found(asked);
  }
  return found(kept(redirectRail(view, reading, wanted)) ?? kept(editRail(request, wanted)));
}
