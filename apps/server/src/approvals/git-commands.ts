import { commandTree } from './command-tree.ts';
import { programName } from './commands.ts';

const GIT_PUBLISHES = ['push', 'send-email', 'request-pull'];
const REMOTE_CHANGES = ['add', 'set-url', 'remove', 'rm', 'rename', 'set-head', 'set-branches'];
const HOSTING_CLIS = ['gh', 'hub', 'glab', 'tea'];

export const PUBLISH_COMMANDS: readonly string[] = [
  ...GIT_PUBLISHES.map((sub) => `git ${sub}`),
  ...REMOTE_CHANGES.map((change) => `git remote ${change}`),
  ...HOSTING_CLIS,
];

function gitSubcommand(args: readonly string[]): { name: string; rest: string[] } | null {
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

function gitSubcommands(command: string): { name: string; rest: string[] }[] {
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

function isForceFlag(token: string): boolean {
  if (token === '--force' || token === '--mirror') return true;
  if (token.startsWith('--force-with-lease') || token === '--force-if-includes') return true;
  return /^-[a-zA-Z]*f[a-zA-Z]*$/.test(token);
}

export function isGitForcePush(command: string): boolean {
  return pushArgs(command).some((args) =>
    args.some((token) => isForceFlag(token) || /^\+[^+]/.test(token)),
  );
}

export function publishesCode(command: string): boolean {
  const hosting = commandTree(command).commands.some((program) =>
    HOSTING_CLIS.includes(programName(program)),
  );
  if (hosting) return true;
  return gitSubcommands(command).some((sub) => {
    if (GIT_PUBLISHES.includes(sub.name)) return true;
    return sub.name === 'remote' && sub.rest.some((token) => REMOTE_CHANGES.includes(token));
  });
}
