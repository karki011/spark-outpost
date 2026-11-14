import { realpathSync } from 'node:fs';
import path from 'node:path';
import { crewFolders } from '../crew/folders.ts';
import { touchesPaths } from './browser-data.ts';
import { commandDirs, commandTree, deleteTargets, type CommandTree } from './command-tree.ts';
import { programName, programTokens, resolveCommandPath } from './commands.ts';
import type { ApprovalRequest } from './decide.ts';
import { commandCwd } from './request-place.ts';
import { scriptRun } from './script-runs.ts';
import type { ShellScript } from './shell-parse.ts';
import { changesNothing, partRequests, shellView, type ShellView } from './shell-view.ts';
import { writeTargets } from './write-targets.ts';

export const CREW_FOLDER_REASON =
  "Sparks' folders and workflows in Spark's data folder can't be changed, moved or deleted by an agent's own tools; the user edits them on the Sparks page";

const TOOL_CHANGES = new Set(['delete', 'move']);

function comparable(target: string): string {
  const resolved = path.resolve(target).replace(/^\/(tmp|var)(?=\/|$)/, '/private/$1');
  return process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function guardedCrewFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  const named = crewFolders(env);
  const real = named.flatMap((folder) => {
    try {
      return [realpathSync(folder)];
    } catch {
      return [];
    }
  });
  return [...new Set([...named, ...real])];
}

function overlaps(target: string, folders: readonly string[]): boolean {
  const wanted = comparable(target);
  return folders.some((folder) => {
    const guarded = comparable(folder);
    return within(guarded, wanted) || within(wanted, guarded);
  });
}

export function inFolders(target: string, folders: readonly string[]): boolean {
  const wanted = comparable(target);
  return folders.some((folder) => within(comparable(folder), wanted));
}

function changedByTool(request: ApprovalRequest): boolean {
  return request.kind === 'edit' || TOOL_CHANGES.has(request.toolKind ?? '');
}

function movedSources(tree: CommandTree, dir: string, home: string): string[] {
  return tree.commands.flatMap((program) => {
    const tokens = programTokens(program);
    if (programName(tokens) !== 'mv') return [];
    const operands = tokens.slice(1).filter((token) => !token.startsWith('-'));
    return operands.slice(0, -1).map((word) => resolveCommandPath(word, dir, home));
  });
}

function targetsOverlap(
  request: ApprovalRequest,
  dirs: readonly string[],
  folders: readonly string[],
  unknownCounts: boolean,
): boolean {
  const command = request.command ?? '';
  const tree = commandTree(command);
  return dirs.some((dir) => {
    const written = writeTargets(command, dir, request.home);
    const deleted = deleteTargets(tree, dir, request.home);
    if (written === null || deleted === null) return unknownCounts;
    const removed = [...deleted, ...movedSources(tree, dir, request.home)];
    return (
      written.some((target) => inFolders(target, folders)) ||
      removed.some((target) => overlaps(target, folders))
    );
  });
}

const DIR_CHANGERS = new Set(['cd', 'pushd', 'popd']);
const COPY_INTO = /^(?:-[a-zA-Z]*t|--target-directory(?:=.*)?)$/;

function copiesOut(tokens: readonly string[]): boolean {
  return programName(tokens) === 'cp' && !tokens.some((token) => COPY_INTO.test(token));
}

function runsFromFolders(
  program: readonly string[],
  dirs: readonly string[],
  home: string,
  folders: readonly string[],
): boolean {
  const tokens = programTokens(program);
  if (DIR_CHANGERS.has(programName(tokens)) || copiesOut(tokens)) return true;
  const run = scriptRun(tokens);
  if (!run) return false;
  return dirs.some((dir) => inFolders(resolveCommandPath(run.word, dir, home), folders));
}

interface Seen {
  request: ApprovalRequest;
  view: ShellView | null;
  dirs: readonly string[];
  cwdInside: boolean;
  folders: readonly string[];
}

function partChanges(part: ApprovalRequest, index: number, seen: Seen): boolean {
  if (!seen.cwdInside && !touchesPaths(part, seen.folders)) return false;
  if (seen.view && (seen.view.reads[index] || seen.view.passive[index])) return false;
  const programs = commandTree(part.command ?? '').commands;
  return !programs.every((program) =>
    runsFromFolders(program, seen.dirs, seen.request.home, seen.folders),
  );
}

function commandChanges(
  request: ApprovalRequest,
  shell: ShellScript | null,
  folders: readonly string[],
): boolean {
  const command = request.command!;
  const cwd = commandCwd(request);
  const known = commandDirs(commandTree(command), cwd, request.home);
  const dirs = known ?? [cwd];
  const cwdInside = dirs.some((dir) => inFolders(dir, folders));
  if (!cwdInside && !touchesPaths(request, folders)) {
    return targetsOverlap(request, dirs, folders, false);
  }
  const asInside = { ...request, readable: [...(request.readable ?? []), ...folders] };
  const view = shellView(asInside, shell);
  if (changesNothing(asInside, view)) return false;
  if (targetsOverlap(request, dirs, folders, true)) return true;
  const parts = view && !view.unparsed ? partRequests(asInside, view) : [asInside];
  const seen: Seen = { request, view: view?.unparsed ? null : view, dirs, cwdInside, folders };
  return parts.some((part, index) => partChanges(part, index, seen));
}

export function crewFolderRules(folders: readonly string[] = guardedCrewFolders()): string[] {
  return folders.flatMap((folder) => [`Edit(/${folder})`, `Edit(/${folder}/**)`]);
}

export function changesCrewFolders(
  request: ApprovalRequest,
  shell: ShellScript | null,
  folders: readonly string[] = guardedCrewFolders(),
): boolean {
  if (folders.length === 0) return false;
  if (request.command) return commandChanges(request, shell, folders);
  return changedByTool(request) && request.paths.some((target) => overlaps(target, folders));
}

export function inReadableFolder(request: ApprovalRequest, target: string): boolean {
  return inFolders(target, request.readable ?? []);
}
