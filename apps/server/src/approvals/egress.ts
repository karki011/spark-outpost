import path from 'node:path';
import type { ApprovalRequest } from './decide.ts';
import { argumentWords, commandTree } from './command-tree.ts';
import { programName, resolveCommandPath } from './commands.ts';
import type { FileLister } from './file-lister.ts';
import { gitSubcommand } from './git-commands.ts';
import { namesAnotherRepo, ownGhUse, ownGitUse, type OwnRepo } from './own-repo.ts';
import { heredocBodies, herestrings, withoutHereText } from './inline-code.ts';
import { readArgs } from './read-args.ts';
import { usesNetwork } from './script-network.ts';
import { peelSubstitutions } from './substitutions.ts';
import { isPython, scriptRun } from './script-runs.ts';
import {
  UNKNOWN_HOST,
  bareHost,
  codeHosts,
  devNetHosts,
  isLocalHost,
  remoteHost,
  resolvedUrlHost,
  remoteHosts,
  unresolved,
  urlHost,
} from './egress-hosts.ts';

export interface Egress {
  via: string;
  hosts: string[];
}

interface Reach {
  via: string;
  hosts: string[] | null;
}

interface EgressPlace {
  cwd: string;
  home: string;
  files: FileLister;
  own?: OwnRepo | null;
}

const MAX_DEPTH = 2;
const COMMENT_LINE = /^\s*#/;

const HOST_CLIENTS = new Set([
  ...['curl', 'wget', 'http', 'https', 'httpie', 'xh', 'xhs', 'aria2c', 'lynx', 'links', 'w3m'],
  ...['ssh', 'mosh', 'telnet', 'nc', 'ncat', 'netcat', 'ftp', 'lftp', 'tftp', 'sftp', 'sshpass'],
  ...['ping', 'ping6', 'traceroute', 'tracepath', 'mtr', 'dig', 'nslookup', 'host', 'whois'],
]);
const REMOTE_COPIES = new Set(['scp', 'rsync']);
const HOST_VALUE_FLAGS = new Set([
  ...['-x', '--proxy', '--preproxy', '--socks4', '--socks4a', '--socks5', '--socks5-hostname'],
  ...['--connect-to', '--resolve', '--doh-url', '-J', '-W'],
]);
const ADDRESS_FILE_FLAGS = new Map<string, ReadonlySet<string>>([
  ['curl', new Set(['-K', '--config'])],
  ['wget', new Set(['-i', '--input-file'])],
]);
const SERVICES = new Set([
  ...['gh', 'hub', 'glab', 'tea', 'aws', 'gcloud', 'gsutil', 'bq', 'az', 'kubectl', 'helm'],
  ...['terraform', 'tofu', 'pulumi', 'doctl', 'flyctl', 'fly', 'heroku', 'vercel', 'netlify'],
  ...['firebase', 'wrangler', 'railway', 'supabase', 's3cmd', 'rclone', 'ngrok', 'cloudflared'],
  ...['twine', 'socat', 'mail', 'mailx', 'sendmail', 'mutt', 'msmtp', 'swaks'],
]);
const JS_PUBLISH = ['publish', 'unpublish', 'deprecate', 'dist-tag', 'adduser', 'login', 'owner'];
const SENDING_VERBS = new Map<string, ReadonlySet<string>>([
  ['npm', new Set([...JS_PUBLISH, 'access', 'token'])],
  ['pnpm', new Set(JS_PUBLISH)],
  ['yarn', new Set([...JS_PUBLISH, 'npm'])],
  ['bun', new Set(['publish'])],
  ['cargo', new Set(['publish', 'login', 'yank', 'owner'])],
  ['gem', new Set(['push', 'yank', 'owner', 'signin'])],
  ['poetry', new Set(['publish'])],
  ['uv', new Set(['publish'])],
  ['docker', new Set(['push', 'login', 'run', 'exec', 'build', 'buildx', 'compose', 'pull'])],
  ['podman', new Set(['push', 'login', 'run', 'exec', 'build', 'compose', 'pull'])],
]);
const GIT_SENDS = new Set(['push', 'send-email']);
const UNSEEN_SENDERS = new Set([
  ...['curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'netcat', 'telnet'],
  ...['gh', 'glab', 'hub', 'aws', 'gcloud', 'gsutil', 'az', 'kubectl'],
]);
const UNSEEN_WORD_BREAK = /[^A-Za-z0-9_./+-]+/;
const UNSEEN_VIA = "a command Spark can't see inside";
const SUBSTITUTED = '$SUBSTITUTED';
const GIT_FETCHES = new Set(['clone', 'fetch', 'pull', 'ls-remote', 'archive']);
const quoted = (name: string) => `\`${name}\``;

function argumentHost(word: string, lenient: boolean): string[] {
  const url = resolvedUrlHost(word);
  if (url) return [url];
  if (unresolved(word)) return lenient ? [UNKNOWN_HOST] : [];
  const host = lenient ? bareHost(word) : (urlHost(word) ?? loopbackHost(word));
  return host ? [host] : [];
}

function loopbackHost(word: string): string | null {
  const host = bareHost(word);
  return host && isLocalHost(host) ? host : null;
}

function hostArgs(name: string, args: readonly string[]): string[] {
  const addressFiles = ADDRESS_FILE_FLAGS.get(name) ?? new Set<string>();
  const hosts: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const word = args[index]!;
    if (word.startsWith('-')) {
      const [flag, value] = word.split(/=(.*)/s);
      if (value !== undefined && HOST_VALUE_FLAGS.has(flag!)) hosts.push(bareHost(value) ?? '');
      if (addressFiles.has(flag!)) hosts.push(UNKNOWN_HOST);
      continue;
    }
    const previous = args[index - 1];
    const afterFlag = previous !== undefined && previous.startsWith('-') && !previous.includes('=');
    const lenient = !afterFlag || HOST_VALUE_FLAGS.has(previous);
    if (previous === '-o' && /proxy/i.test(word)) hosts.push(UNKNOWN_HOST);
    else if (addressFiles.has(previous ?? '')) hosts.push(UNKNOWN_HOST);
    else hosts.push(...argumentHost(word, lenient));
  }
  const found = hosts.filter((host) => host !== '');
  return found.length > 0 ? found : [UNKNOWN_HOST];
}

function copyHosts(args: readonly string[]): string[] {
  return args.flatMap((word) => {
    if (word.startsWith('-')) return [];
    if (unresolved(word)) return [UNKNOWN_HOST];
    return remoteHost(word) ?? [];
  });
}

function positionals(args: readonly string[]): string[] {
  return args.filter((word) => !word.startsWith('-'));
}

function isPathLike(word: string): boolean {
  return word.startsWith('/') || word.startsWith('.') || word.startsWith('~');
}

function gitReach(args: readonly string[]): Reach | null {
  const sub = gitSubcommand(args);
  if (!sub) return null;
  const repo = positionals(sub.rest)[0];
  if (GIT_SENDS.has(sub.name)) {
    if (repo && isPathLike(repo)) return null;
    const host = repo ? remoteHost(repo) : null;
    return { via: quoted(`git ${sub.name}`), hosts: host ? [host] : null };
  }
  if (!GIT_FETCHES.has(sub.name) || !repo || isPathLike(repo)) return null;
  const host = remoteHost(repo);
  return host ? { via: quoted(`git ${sub.name}`), hosts: [host] } : null;
}

function codeReach(code: string, via: string, python: boolean): Reach | null {
  if (!usesNetwork(code, python)) return null;
  const hosts = codeHosts(code);
  return { via, hosts: hosts.length > 0 ? hosts : [UNKNOWN_HOST] };
}

interface Scan {
  command: string;
  place: EgressPlace;
  depth: number;
}

function scriptReach(program: readonly string[], scan: Scan): Reach | null {
  const run = scriptRun(program);
  if (!run || unresolved(run.word)) return null;
  const file = resolveCommandPath(run.word, scan.place.cwd, scan.place.home);
  const script = scan.place.files.script(file);
  if (!script || script.committed || script.text === null) return null;
  const via = quoted(path.basename(file));
  if (run.language !== 'shell') return codeReach(script.text, via, file.endsWith('.py'));
  if (scan.depth >= MAX_DEPTH) return { via, hosts: [UNKNOWN_HOST] };
  const body = script.text
    .split('\n')
    .filter((line) => !COMMENT_LINE.test(line))
    .join('\n');
  return commandReach(body, scan.place, scan.depth + 1);
}

function interpreterReach(program: readonly string[], scan: Scan): Reach | null {
  const args = readArgs(program);
  if (!args) return null;
  const stdin = args.stdinCode
    ? [...heredocBodies(scan.command), ...herestrings(scan.command)]
    : [];
  const name = programName(program);
  const python = isPython(name);
  const reaches = [...args.code, ...stdin].flatMap(
    (code) => codeReach(code, quoted(name), python) ?? [],
  );
  return merge(reaches);
}

function ownRepoUse(name: string, args: readonly string[], scan: Scan): boolean {
  const own = scan.place.own;
  if (!own || namesAnotherRepo(scan.command)) return false;
  if (name === 'gh') return ownGhUse(args, own);
  return name === 'git' && ownGitUse(args, own);
}

function programReach(
  program: readonly string[],
  scan: Scan,
  unredirected: readonly string[],
): Reach | null {
  const name = programName(program);
  const args = program.slice(1);
  if (ownRepoUse(name, unredirected.slice(1), scan)) return null;
  if (HOST_CLIENTS.has(name)) return { via: quoted(name), hosts: hostArgs(name, args) };
  if (REMOTE_COPIES.has(name)) {
    const hosts = copyHosts(args);
    return hosts.length > 0 ? { via: quoted(name), hosts } : null;
  }
  if (SERVICES.has(name)) return { via: quoted(name), hosts: null };
  if (name === 'git') return gitReach(args);
  if (name === 'openssl' && args[0] === 's_client') return { via: quoted(name), hosts: null };
  const verb = positionals(args)[0];
  if (verb && SENDING_VERBS.get(name)?.has(verb)) {
    return { via: quoted(`${name} ${verb}`), hosts: null };
  }
  return interpreterReach(program, scan) ?? scriptReach(program, scan);
}

function merge(reaches: readonly Reach[]): Reach | null {
  const first = reaches[0];
  if (!first) return null;
  const everyHost = reaches.every((reach) => reach.hosts !== null);
  const hosts = reaches.flatMap((reach) => reach.hosts ?? []);
  return { via: first.via, hosts: everyHost ? hosts : null };
}

function stillSends(reach: Reach): boolean {
  return reach.hosts === null || remoteHosts(reach.hosts).length > 0;
}

function wordReach(command: string): Reach | null {
  const words = command.split(UNSEEN_WORD_BREAK).map((word) => path.basename(word));
  const sender = words.find(
    (word, index) =>
      UNSEEN_SENDERS.has(word) || (word === 'git' && GIT_SENDS.has(words[index + 1] ?? '')),
  );
  const opens = sender !== undefined || devNetHosts(command).length > 0;
  if (!opens && !usesNetwork(command, false)) return null;
  const hosts = [...codeHosts(command), ...devNetHosts(command)];
  return {
    via: sender ? quoted(sender) : UNSEEN_VIA,
    hosts: hosts.length > 0 ? hosts : [UNKNOWN_HOST],
  };
}

function unseenReach(command: string, place: EgressPlace, depth: number): Reach | null {
  const peeled = depth < MAX_DEPTH ? peelSubstitutions(command, SUBSTITUTED) : null;
  if (!peeled || peeled.inner.length === 0 || commandTree(peeled.outer).opaque) {
    return wordReach(command);
  }
  const reaches = [peeled.outer, ...peeled.inner].flatMap(
    (part) => commandReach(part, place, depth + 1) ?? [],
  );
  return merge(reaches.filter(stillSends));
}

function commandReach(command: string, place: EgressPlace, depth: number): Reach | null {
  const seen = withoutHereText(command);
  const tree = commandTree(seen);
  if (tree.opaque) return unseenReach(seen, place, depth);
  const scan: Scan = { command, place, depth };
  const devNet = devNetHosts(command);
  const reaches = [
    ...(devNet.length > 0 ? [{ via: quoted('/dev/tcp'), hosts: devNet }] : []),
    ...tree.commands.flatMap(
      (program) => programReach(program, scan, argumentWords(tree, program)) ?? [],
    ),
  ].filter(stillSends);
  return merge(reaches);
}

function asEgress(reach: Reach | null): Egress | null {
  if (!reach || !stillSends(reach)) return null;
  return { via: reach.via, hosts: remoteHosts(reach.hosts ?? []) };
}

export function commandEgress(command: string, place: EgressPlace): Egress | null {
  return asEgress(commandReach(command, place, 0));
}

export function egressOf(
  request: ApprovalRequest,
  files: FileLister,
  own: OwnRepo | null = null,
): Egress | null {
  if (request.mcpServer) return { via: `the ${request.mcpServer} MCP server`, hosts: [] };
  if (request.address) {
    return asEgress({ via: 'a web request', hosts: [urlHost(request.address) ?? UNKNOWN_HOST] });
  }
  if (request.toolKind === 'fetch') {
    const hosts = codeHosts(request.title);
    return asEgress({ via: 'a web request', hosts: hosts.length > 0 ? hosts : [UNKNOWN_HOST] });
  }
  if (request.kind !== 'execute' || !request.command) return null;
  const cwd = request.cwd ?? request.roots[0]?.path ?? request.home;
  return commandEgress(request.command, { cwd, home: request.home, files, own });
}

export function egressTarget(egress: Egress): string {
  const known = egress.hosts.filter((host) => host !== UNKNOWN_HOST);
  if (known.length === 0) return `out through ${egress.via}`;
  const shown = known.slice(0, 3).join(', ');
  return known.length > 3 ? `to ${shown} and more` : `to ${shown}`;
}
