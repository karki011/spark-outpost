import path from 'node:path';
import type { ApprovalRequest } from './decide.ts';
import { commandTree } from './command-tree.ts';
import { programName, resolveCommandPath } from './commands.ts';
import type { FileLister } from './file-lister.ts';
import { gitSubcommand } from './git-commands.ts';
import { heredocBodies, herestrings, withoutHereText } from './inline-code.ts';
import { readArgs } from './read-args.ts';
import { scriptRun } from './script-runs.ts';
import {
  UNKNOWN_HOST,
  bareHost,
  codeHosts,
  devNetHosts,
  remoteHost,
  remoteHosts,
  unresolved,
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
const GIT_FETCHES = new Set(['clone', 'fetch', 'pull', 'ls-remote', 'archive']);
const NETWORK_CODE =
  /\b(?:requests|httpx|aiohttp|urllib\d?|urlopen|http\.client|socket|smtplib|ftplib|telnetlib|paramiko|websockets?|XMLHttpRequest|WebSocket|axios|undici|node-fetch|EventSource|sendBeacon|dgram|Net::HTTP|open-uri|HTTParty|Faraday|LWP|IO::Socket|HTTP::Tiny|curl_exec|curl_init|fsockopen|stream_socket_client)\b|\bfetch\s*\(|\bhttps?\.(?:request|get)\s*\(|\bnet\.(?:connect|createConnection|Socket)\b|\btls\.connect\b|\b(?:Deno|Bun)\.connect\b|\/inet\/|\/dev\/(?:tcp|udp)\//;

const quoted = (name: string) => `\`${name}\``;

function hostArgs(args: readonly string[]): string[] {
  const hosts: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const word = args[index]!;
    if (word.startsWith('-')) {
      const [flag, value] = word.split(/=(.*)/s);
      if (value !== undefined && HOST_VALUE_FLAGS.has(flag!)) hosts.push(bareHost(value) ?? '');
      continue;
    }
    const previous = args[index - 1];
    const afterFlag = previous !== undefined && previous.startsWith('-') && !previous.includes('=');
    if (unresolved(word) || (previous === '-o' && /proxy/i.test(word))) {
      hosts.push(UNKNOWN_HOST);
      continue;
    }
    const lenient = !afterFlag || HOST_VALUE_FLAGS.has(previous);
    const host = lenient ? bareHost(word) : remoteHost(word);
    if (host) hosts.push(host);
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

function codeReach(code: string, via: string): Reach | null {
  if (!NETWORK_CODE.test(code)) return null;
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
  if (run.language !== 'shell') return codeReach(script.text, via);
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
  const via = quoted(programName(program));
  const reaches = [...args.code, ...stdin].flatMap((code) => codeReach(code, via) ?? []);
  return merge(reaches);
}

function programReach(program: readonly string[], scan: Scan): Reach | null {
  const name = programName(program);
  const args = program.slice(1);
  if (HOST_CLIENTS.has(name)) return { via: quoted(name), hosts: hostArgs(args) };
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

function commandReach(command: string, place: EgressPlace, depth: number): Reach | null {
  const tree = commandTree(withoutHereText(command));
  if (tree.opaque) return { via: "a command Spark can't see inside", hosts: [UNKNOWN_HOST] };
  const scan: Scan = { command, place, depth };
  const devNet = devNetHosts(command);
  const reaches = [
    ...(devNet.length > 0 ? [{ via: quoted('/dev/tcp'), hosts: devNet }] : []),
    ...tree.commands.flatMap((program) => programReach(program, scan) ?? []),
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

export function egressOf(request: ApprovalRequest, files: FileLister): Egress | null {
  if (request.mcpServer) return { via: `the ${request.mcpServer} MCP server`, hosts: [] };
  if (request.toolKind === 'fetch') {
    const hosts = codeHosts(request.title);
    return asEgress({ via: 'a web request', hosts: hosts.length > 0 ? hosts : [UNKNOWN_HOST] });
  }
  if (request.kind !== 'execute' || !request.command) return null;
  const cwd = request.cwd ?? request.roots[0]?.path ?? request.home;
  return commandEgress(request.command, { cwd, home: request.home, files });
}

export function egressTarget(egress: Egress): string {
  const known = egress.hosts.filter((host) => host !== UNKNOWN_HOST);
  if (known.length === 0) return `out through ${egress.via}`;
  const shown = known.slice(0, 3).join(', ');
  return known.length > 3 ? `to ${shown} and more` : `to ${shown}`;
}
