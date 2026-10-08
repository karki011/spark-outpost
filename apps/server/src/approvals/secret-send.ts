import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { secretFileValues } from '../audit/secret-values.ts';
import { isSecretPath } from '../projects/path-policy.ts';
import { runGit } from '../ship/git.ts';
import { commandTree } from './command-tree.ts';
import { programName, resolveCommandPath } from './commands.ts';
import type { ApprovalRequest } from './decide.ts';
import { gitSubcommand } from './git-commands.ts';
import { withoutHereText } from './inline-code.ts';
import { ghOnlyReads, ghSendsQuery } from './gh-reads.ts';
import { commandCwd } from './request-place.ts';
import { peelSubstitutions } from './substitutions.ts';

export type SecretSend =
  { kind: 'found'; files: string[] } | { kind: 'unreadable' } | { kind: 'clean' };

interface SecretSource {
  file: string;
  values: string[];
}

interface Sent {
  text: string;
  unreadable: boolean;
}

const MAX_SECRET_FILES = 50;
const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_BYTES = 1024 * 1024;
const MIN_PLAIN_LENGTH = 12;
const MIN_MIXED_LENGTH = 8;
const UNRESOLVED = /\$|`/;
const PUSH_VALUE_FLAGS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const LISTINGS = [
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
];

function distinctive(value: string): boolean {
  if (value.length >= MIN_PLAIN_LENGTH) return true;
  return value.length >= MIN_MIXED_LENGTH && /\d/.test(value) && /[a-z]/i.test(value);
}

async function secretFiles(root: string): Promise<string[]> {
  const listed = await Promise.all(LISTINGS.map((args) => runGit(root, args)));
  const names = listed.flatMap((result) => (result.code === 0 ? result.stdout.split('\0') : []));
  const secrets = names.filter((name) => name !== '' && !name.endsWith('/') && isSecretPath(name));
  return [...new Set(secrets)].slice(0, MAX_SECRET_FILES);
}

async function mainCheckout(root: string): Promise<string | null> {
  const common = await runGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const gitDir = common.stdout.trim();
  return common.code === 0 && path.basename(gitDir) === '.git' ? path.dirname(gitDir) : null;
}

async function withMainCheckouts(roots: readonly string[]): Promise<string[]> {
  const mains = await Promise.all(roots.map(mainCheckout));
  return [...new Set([...roots, ...mains.filter((main): main is string => main !== null)])];
}

async function secretSources(roots: readonly string[]): Promise<SecretSource[]> {
  const sources: SecretSource[] = [];
  for (const root of await withMainCheckouts(roots)) {
    for (const file of await secretFiles(root)) {
      const values = (await secretFileValues(path.join(root, file))).filter(distinctive);
      if (values.length > 0) sources.push({ file, values });
    }
  }
  return sources;
}

function pushedRefs(args: readonly string[]): string[] {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (PUSH_VALUE_FLAGS.has(token)) index += 1;
    else if (!token.startsWith('-')) positional.push(token);
  }
  const sources = positional
    .slice(1)
    .map((refspec) => refspec.replace(/^\+/, '').split(':')[0]!)
    .filter((source) => source !== '');
  return sources.length > 0 ? sources : ['HEAD'];
}

async function pushedText(cwd: string, refs: readonly string[]): Promise<Sent> {
  if (refs.some((ref) => UNRESOLVED.test(ref) || ref.startsWith('-'))) {
    return { text: '', unreadable: true };
  }
  const log = await runGit(cwd, [
    ...['log', '-p', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--format=%B'],
    ...refs,
    '--not',
    '--remotes',
  ]);
  if (log.code !== 0) return { text: '', unreadable: true };
  const added = log.stdout.split('\n').filter((line) => !line.startsWith('-'));
  return { text: added.join('\n'), unreadable: false };
}

function uploadCandidates(args: readonly string[]): string[] {
  return args.flatMap((word) => {
    const value = word.startsWith('-') && word !== '-' ? word.split(/=(.*)/s)[1] : word;
    if (value === undefined || value === '') return [];
    const assigned = value.split(/=(.*)/s)[1];
    return [value, ...(assigned ? [assigned] : [])].map((candidate) => candidate.replace(/^@/, ''));
  });
}

async function uploadedText(args: readonly string[], cwd: string, home: string): Promise<Sent> {
  const candidates = [...new Set(uploadCandidates(args))];
  let unreadable = candidates.some((candidate) => candidate === '-' || UNRESOLVED.test(candidate));
  const texts: string[] = [];
  for (const candidate of candidates.filter((word) => !UNRESOLVED.test(word))) {
    const file = resolveCommandPath(candidate, cwd, home);
    const found = await stat(file).catch(() => null);
    if (!found?.isFile()) continue;
    if (found.size > MAX_UPLOAD_BYTES || texts.length >= MAX_UPLOAD_FILES) unreadable = true;
    else texts.push(await readFile(file, 'utf8').catch(() => ''));
  }
  return { text: texts.join('\n'), unreadable };
}

async function sentBy(program: readonly string[], cwd: string, home: string): Promise<Sent | null> {
  const name = programName(program);
  if (name === 'gh') {
    const args = program.slice(1);
    const sendsNothing = ghOnlyReads(args) && !ghSendsQuery(args);
    return sendsNothing ? null : uploadedText(args, cwd, home);
  }
  const sub = name === 'git' ? gitSubcommand(program.slice(1)) : null;
  return sub?.name === 'push' ? pushedText(cwd, pushedRefs(sub.rest)) : null;
}

function filesIn(text: string, sources: readonly SecretSource[]): string[] {
  const found = sources.filter((source) => source.values.some((value) => text.includes(value)));
  return [...new Set(found.map((source) => source.file))];
}

export async function pushedSecretFiles(root: string, branch: string): Promise<string[]> {
  const pushed = await pushedText(root, [branch]);
  return pushed.unreadable ? [] : filesIn(pushed.text, await secretSources([root]));
}

export function sendsContent(command: string): boolean {
  return /\b(?:gh|git)\b/.test(command);
}

interface Seen {
  programs: string[][];
  unreadable: boolean;
}

function catFiles(inner: string): string[] | null {
  const tree = commandTree(inner);
  const [program, ...others] = tree.commands;
  if (tree.opaque || !program || others.length > 0 || programName(program) !== 'cat') return null;
  return program.slice(1).filter((word) => !word.startsWith('-'));
}

function seenPrograms(command: string): Seen {
  const text = withoutHereText(command);
  const tree = commandTree(text);
  if (!tree.opaque) return { programs: tree.commands, unreadable: false };
  const peeled = peelSubstitutions(text, '');
  const outer = peeled ? commandTree(peeled.outer) : null;
  if (!peeled || !outer || outer.opaque) return { programs: [], unreadable: true };
  const read = peeled.inner.map(catFiles);
  const files = read.flatMap((names) => names ?? []);
  const programs = outer.commands.map((program) =>
    programName(program) === 'gh' ? [...program, ...files] : program,
  );
  return { programs, unreadable: read.includes(null) };
}

export async function secretSend(request: ApprovalRequest): Promise<SecretSend> {
  if (!request.command || !sendsContent(request.command)) return { kind: 'clean' };
  const seen = seenPrograms(request.command);
  const cwd = commandCwd(request);
  const sent: Sent[] = [];
  for (const program of seen.programs) {
    const found = await sentBy(program, cwd, request.home);
    if (found) sent.push(found);
  }
  if (sent.length === 0) return { kind: 'clean' };
  const sources = await secretSources(request.roots.map((root) => root.path));
  const text = [request.command, ...sent.map((part) => part.text)].join('\n');
  const files = filesIn(text, sources);
  if (files.length > 0) return { kind: 'found', files };
  const unreadable = seen.unreadable || sent.some((part) => part.unreadable);
  return { kind: unreadable ? 'unreadable' : 'clean' };
}
