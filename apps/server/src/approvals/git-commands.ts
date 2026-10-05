import { commandTree } from './command-tree.ts';
import { programName } from './commands.ts';

const GIT_PUBLISHES = ['push', 'send-email', 'request-pull'];
const REMOTE_CHANGES = ['add', 'set-url', 'remove', 'rm', 'rename', 'set-head', 'set-branches'];
export const HOSTING_CLIS = ['gh', 'hub', 'glab', 'tea'];

export const PUBLISH_COMMANDS: readonly string[] = [
  ...GIT_PUBLISHES.map((sub) => `git ${sub}`),
  ...REMOTE_CHANGES.map((change) => `git remote ${change}`),
  ...HOSTING_CLIS,
];

export function gitSubcommand(args: readonly string[]): { name: string; rest: string[] } | null {
  let index = 0;
  while (index < args.length) {
    const token = args[index]!;
    if (token === '-C' || token === '-c' || token === '--git-dir' || token === '--work-tree') {
      index += 2;
    } else if (token.startsWith('-')) index += 1;
    else return { name: token, rest: args.slice(index + 1) };
  }
  return null;
}

export function gitSubcommands(command: string): { name: string; rest: string[] }[] {
  return commandTree(command).commands.flatMap((program) => {
    if (programName(program) !== 'git') return [];
    const sub = gitSubcommand(program.slice(1));
    return sub ? [sub] : [];
  });
}

function pushArgs(command: string): string[][] {
  return gitSubcommands(command)
    .filter((sub) => sub.name === 'push')
    .map((sub) => sub.rest);
}

export function isGitPush(command: string): boolean {
  return pushArgs(command).length > 0;
}

export const MIRROR_PUSH_REASON = 'Mirror pushes are refused';
export const PLAIN_FORCE_REASON =
  'Plain force pushes are refused; use git push --force-with-lease <remote> <branch> instead';
export const UNNAMED_FORCE_REASON =
  'Force pushes must name the branch: git push --force-with-lease <remote> <branch>';
const PROTECTED_BRANCHES = ['main', 'master'];

export function protectedForceReason(branch: string): string {
  return `Force pushes to ${branch} are refused`;
}

export type ForcePush = { kind: 'refuse'; reason: string } | { kind: 'ask'; branches: string[] };

const PUSH_VALUE_FLAGS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const EVERY_REF_FLAGS = new Set(['--all', '--branches', '--tags']);

interface PushShape {
  remote: string | null;
  plain: boolean;
  lease: boolean;
  mirror: boolean;
  everyRef: boolean;
  refspecs: string[];
}

function pushShape(args: readonly string[]): PushShape {
  const shape: PushShape = {
    remote: null,
    plain: false,
    lease: false,
    mirror: false,
    everyRef: false,
    refspecs: [],
  };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (PUSH_VALUE_FLAGS.has(token)) index += 1;
    else if (token === '--mirror') shape.mirror = true;
    else if (EVERY_REF_FLAGS.has(token)) shape.everyRef = true;
    else if (token.startsWith('--force-with-lease')) shape.lease = true;
    else if (token === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(token)) shape.plain = true;
    else if (!token.startsWith('-')) positional.push(token);
  }
  shape.remote = positional[0] ?? null;
  shape.refspecs = positional.slice(1);
  if (shape.refspecs.some((refspec) => refspec.startsWith('+'))) shape.plain = true;
  return shape;
}

function destination(refspec: string): string | null {
  const bare = refspec.replace(/^\+/, '');
  const colon = bare.indexOf(':');
  const target = (colon === -1 ? bare : bare.slice(colon + 1)).replace(/^refs\/heads\//, '');
  if (!target || target === 'HEAD' || target === '@' || target.startsWith('refs/')) return null;
  return target;
}

export interface PushTarget {
  remote: string | null;
  branches: (string | null)[];
  widens: boolean;
}

const WIDENING_PUSH_FLAGS = new Set(['--delete', '--prune', '--repo']);

function widensPush(token: string): boolean {
  if (WIDENING_PUSH_FLAGS.has(token.split('=')[0]!)) return true;
  return /^-[a-zA-Z]+$/.test(token) && token.includes('d');
}

export function pushTargets(command: string): PushTarget[] {
  return pushArgs(command).map((args) => {
    const shape = pushShape(args);
    return {
      remote: shape.remote,
      branches: shape.refspecs.map((refspec) =>
        refspec.replace(/^\+/, '').startsWith(':') ? null : destination(refspec),
      ),
      widens: shape.mirror || shape.everyRef || args.some(widensPush),
    };
  });
}

function forcePushOf(shape: PushShape, protectedBranches: readonly string[]): ForcePush | null {
  if (shape.mirror) return { kind: 'refuse', reason: MIRROR_PUSH_REASON };
  if (!shape.plain && !shape.lease) return null;
  if (shape.plain) return { kind: 'refuse', reason: PLAIN_FORCE_REASON };
  const branches = shape.refspecs.map(destination);
  if (shape.everyRef || branches.length === 0 || branches.includes(null)) {
    return { kind: 'refuse', reason: UNNAMED_FORCE_REASON };
  }
  const named = branches.filter((branch): branch is string => branch !== null);
  const guarded = named.find((branch) => protectedBranches.includes(branch));
  if (guarded) return { kind: 'refuse', reason: protectedForceReason(guarded) };
  return { kind: 'ask', branches: named };
}

export function forcePush(command: string, defaultBranch: string | null = null): ForcePush | null {
  const protectedBranches: string[] = [
    ...PROTECTED_BRANCHES,
    ...(defaultBranch ? [defaultBranch] : []),
  ];
  const found = pushArgs(command).flatMap(
    (args) => forcePushOf(pushShape(args), protectedBranches) ?? [],
  );
  const refused = found.find((entry) => entry.kind === 'refuse');
  if (refused) return refused;
  if (found.length === 0) return null;
  return {
    kind: 'ask',
    branches: found.flatMap((entry) => (entry.kind === 'ask' ? entry.branches : [])),
  };
}

function gitPublishes(command: string, publishing: readonly string[]): boolean {
  return gitSubcommands(command).some((sub) => {
    if (publishing.includes(sub.name)) return true;
    return sub.name === 'remote' && sub.rest.some((token) => REMOTE_CHANGES.includes(token));
  });
}

function publishes(command: string, publishing: readonly string[]): boolean {
  const hosting = commandTree(command).commands.some((program) =>
    HOSTING_CLIS.includes(programName(program)),
  );
  return hosting || gitPublishes(command, publishing);
}

export function gitPublishesBesidesPush(command: string): boolean {
  return gitPublishes(
    command,
    GIT_PUBLISHES.filter((name) => name !== 'push'),
  );
}

export function publishesCode(command: string): boolean {
  return publishes(command, GIT_PUBLISHES);
}

export function publishesBesidesPush(command: string): boolean {
  return publishes(
    command,
    GIT_PUBLISHES.filter((name) => name !== 'push'),
  );
}

export const BUILDER_GIT_OPS = [
  'stash',
  'checkout',
  'switch',
  'reset',
  'restore',
  'clean',
  'commit',
  'merge',
  'rebase',
  'cherry-pick',
  'am',
  'worktree',
];

const BRANCH_DELETE = new Set(['-d', '-D', '--delete']);

export type GitSub = { name: string; rest: string[] };

export function changesGitState(
  command: string,
  harmless: (sub: GitSub) => boolean = () => false,
): boolean {
  return gitSubcommands(command).some(
    (sub) =>
      (BUILDER_GIT_OPS.includes(sub.name) && !harmless(sub)) ||
      (sub.name === 'branch' && sub.rest.some((token) => BRANCH_DELETE.has(token))),
  );
}

const REPO_WRITES = ['add', 'rm', 'mv', 'apply', 'pull', 'tag', 'init', 'clone'];

export function writesRepo(command: string): boolean {
  if (changesGitState(command)) return true;
  return gitSubcommands(command).some((sub) => REPO_WRITES.includes(sub.name));
}

const CONFIG_ELSEWHERE = new Set(['--global', '--system', '--file', '-f', '--blob']);
const CONFIG_WRITE_FLAGS = new Set([
  '--add',
  '--unset',
  '--unset-all',
  '--replace-all',
  '--rename-section',
  '--remove-section',
  '--edit',
  '-e',
]);
const CONFIG_WRITE_VERBS = new Set(['set', 'unset', 'edit', 'rename-section', 'remove-section']);
const CONFIG_READ_VERBS = new Set(['get', 'list']);

function configWrites(args: readonly string[]): boolean {
  if (args.some((arg) => CONFIG_ELSEWHERE.has(arg) || arg.startsWith('--file='))) return false;
  if (args.some((arg) => CONFIG_WRITE_FLAGS.has(arg))) return true;
  const words = args.filter((arg) => !arg.startsWith('-'));
  if (CONFIG_WRITE_VERBS.has(words[0] ?? '')) return true;
  if (CONFIG_READ_VERBS.has(words[0] ?? '')) return false;
  return words.length >= 2 && !args.some((arg) => arg.startsWith('--get') || arg === '-l');
}

export function setsGitConfig(command: string): boolean {
  return gitSubcommands(command).some((sub) => sub.name === 'config' && configWrites(sub.rest));
}
