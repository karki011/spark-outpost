import { grepRecurses } from './command-kinds.ts';
import { programName } from './commands.ts';

export interface ReadArgs {
  files: string[];
  code: string[];
  recursive: boolean;
  hidden: boolean;
  stdinCode: boolean;
  include: string[];
  exclude: string[];
}

type Args = readonly string[];

interface Reader {
  skip?: readonly string[];
  pairs?: readonly string[];
  fileFlags?: readonly string[];
  codeFlag?: (flag: string) => boolean;
  first?: 'pattern' | 'code';
  firstGivenBy?: readonly string[];
  dropLast?: boolean;
  positionalFiles?: 'always' | 'with-code' | 'never';
  recursive?: (args: Args) => boolean;
  searchesHere?: boolean;
  filters?: boolean;
  hidden?: (args: Args) => boolean;
  stdinCode?: (args: Args, positional: Args, code: Args) => boolean;
}

const PLAIN: Reader = {};
const has = (args: Args, flags: readonly string[]) => args.some((arg) => flags.includes(arg));
const bundled = (letters: string) => (args: Args) =>
  args.some((arg) => new RegExp(`^-[a-zA-Z]*[${letters}]`).test(arg));

const GREP: Reader = {
  skip: [
    ...['-e', '--regexp', '-m', '--max-count', '-A', '-B', '-C', '-d', '-D', '--context'],
    ...['--include', '--exclude', '--exclude-dir'],
  ],
  fileFlags: ['-f', '--file'],
  first: 'pattern',
  firstGivenBy: ['-e', '--regexp', '-f', '--file'],
  recursive: grepRecurses,
  searchesHere: true,
  filters: true,
};

const RG_SKIP = ['-e', '--regexp', '-g', '--glob', '--iglob', '-t', '--type', '-T', '--type-not'];

const RG: Reader = {
  skip: [...RG_SKIP, '-m', '--max-count', '-A', '-B', '-C', '-r', '--replace', '-d', '-j', '-M'],
  fileFlags: ['-f', '--file', '--ignore-file'],
  first: 'pattern',
  firstGivenBy: ['-e', '--regexp', '-f', '--file', '--files'],
  recursive: () => true,
  searchesHere: true,
  hidden: (args) => args.some((arg) => arg === '--hidden' || arg === '-.' || /^-u{2,}$/.test(arg)),
};

const SED: Reader = {
  skip: ['-l'],
  fileFlags: ['-f', '--file'],
  codeFlag: (flag) => flag === '-e' || flag === '--expression',
  first: 'code',
  firstGivenBy: ['-e', '--expression', '-f', '--file'],
};

const AWK: Reader = {
  skip: ['-F', '-v'],
  fileFlags: ['-f'],
  first: 'code',
  firstGivenBy: ['-f'],
};

const JQ: Reader = {
  skip: ['--indent', '--tab'],
  pairs: ['--arg', '--argjson', '--slurpfile', '--rawfile'],
  fileFlags: ['-f', '--from-file'],
  first: 'code',
  firstGivenBy: ['-f', '--from-file'],
};

const COPY: Reader = {
  skip: ['-t', '--target-directory', '-P', '-S', '-e', '-o', '-F', '-l', '-c'],
  dropLast: true,
  recursive: (args) => has(args, ['--recursive', '--archive']) || bundled('rRa')(args),
};

const ARCHIVE: Reader = { recursive: () => true };
const ZIP: Reader = { skip: ['-x', '-i', '-P'], recursive: bundled('r') };

const noScriptGiven = (args: Args, positional: Args, code: Args) =>
  code.length === 0 &&
  (positional.length === 0 || positional[0] === '-') &&
  !has(args, ['-m', '-V', '-v', '--version', '-h', '--help']);

const PYTHON: Reader = {
  skip: ['-m', '-W', '-X'],
  codeFlag: (flag) => /^-[a-zA-Z]*c$/.test(flag),
  positionalFiles: 'never',
  stdinCode: noScriptGiven,
};

const NODE: Reader = {
  skip: ['-r', '--require', '--import', '--input-type', '--conditions'],
  codeFlag: (flag) => ['-e', '--eval', '-p', '--print'].includes(flag),
  positionalFiles: 'never',
  stdinCode: noScriptGiven,
};

const SCRIPTED: Reader = {
  skip: ['-I', '-r', '-M', '-m'],
  codeFlag: (flag) => /^-[a-zA-Z]*[eE]$/.test(flag),
  positionalFiles: 'with-code',
  stdinCode: noScriptGiven,
};

const PHP: Reader = {
  codeFlag: (flag) => flag === '-r',
  positionalFiles: 'never',
  stdinCode: noScriptGiven,
};

const READERS = new Map<string, Reader>([
  ...[
    'cat',
    'pr',
    'expand',
    'unexpand',
    'pv',
    'less',
    'more',
    'bat',
    'tac',
    'nl',
    'rev',
    'strings',
    'base32',
    'md5',
    'md5sum',
    'shasum',
    'sha1sum',
    'sha256sum',
    'sha512sum',
    'cksum',
    'paste',
    'join',
    'comm',
    'diff',
    'cmp',
    'fold',
    'fmt',
    'column',
    'zcat',
    'gzip',
    'gunzip',
    'bzip2',
    'bunzip2',
    'xz',
    'unxz',
    'unzip',
    'source',
    '.',
  ].map((name): [string, Reader] => [name, PLAIN]),
  ['head', { skip: ['-n', '-c'] }],
  ['tail', { skip: ['-n', '-c'] }],
  ['cut', { skip: ['-d', '-f', '-c', '-b'] }],
  ['sort', { skip: ['-k', '-t', '-o', '-S', '-T'] }],
  ['uniq', { skip: ['-f', '-s', '-w'] }],
  ['iconv', { skip: ['-f', '-t'] }],
  ['xxd', { skip: ['-l', '-s', '-c', '-g', '-o'] }],
  ['od', { skip: ['-N', '-j', '-t', '-A', '-w'] }],
  ['hexdump', { skip: ['-n', '-s', '-e'], fileFlags: ['-f'] }],
  ['base64', { skip: ['-o', '--output', '-b', '-w'], fileFlags: ['-i', '--input'] }],
  ['openssl', { skip: ['-out', '-pass', '-passin'], fileFlags: ['-in', '-inkey', '-kfile'] }],
  ['grep', GREP],
  ['egrep', GREP],
  ['fgrep', GREP],
  ['rg', RG],
  ['ag', { ...RG, hidden: (args) => has(args, ['--hidden', '-u', '--unrestricted']) }],
  ['ack', { ...GREP, recursive: () => true }],
  ['sed', SED],
  ['awk', AWK],
  ['gawk', AWK],
  ['mawk', AWK],
  ['jq', JQ],
  ['yq', JQ],
  ['cp', COPY],
  ['mv', COPY],
  ['scp', { ...COPY, skip: [...(COPY.skip ?? []), '-i'] }],
  ['rsync', COPY],
  ['tar', ARCHIVE],
  ['zip', ZIP],
  ['python', PYTHON],
  ['python2', PYTHON],
  ['python3', PYTHON],
  ['node', NODE],
  ['bun', NODE],
  ['ruby', SCRIPTED],
  ['perl', SCRIPTED],
  ['php', PHP],
]);

const CURL_UPLOADS = ['-T', '--upload-file', '-K', '--config'];
const CURL_DATA = ['-d', '--data', '--data-binary', '--data-urlencode', '--json', '-F', '--form'];
const CURL_FILE_REFERENCE = /(?:^|[=\w])[@<]([^;]+)/;
const WGET_FILES = ['--post-file', '--body-file', '-i', '--input-file'];

function flagParts(arg: string): { flag: string; inline: string | undefined } {
  const equals = arg.indexOf('=');
  if (!arg.startsWith('--') || equals < 0) return { flag: arg, inline: undefined };
  return { flag: arg.slice(0, equals), inline: arg.slice(equals + 1) };
}

function valuesOf(args: Args, flags: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const { flag, inline } = flagParts(args[index]!);
    if (!flags.includes(flag)) continue;
    const value = inline ?? args[++index];
    if (value !== undefined) values.push(value);
  }
  return values;
}

function fetchReads(name: string, args: Args): string[] {
  if (name === 'wget') return valuesOf(args, WGET_FILES);
  const uploads = valuesOf(args, CURL_UPLOADS);
  const referenced = valuesOf(args, CURL_DATA).flatMap((value) => {
    const match = CURL_FILE_REFERENCE.exec(value);
    return match ? [match[1]!] : [];
  });
  return [...uploads, ...referenced];
}

export function plainRead(files: string[]): ReadArgs {
  return {
    files,
    code: [],
    recursive: false,
    hidden: true,
    stdinCode: false,
    include: [],
    exclude: [],
  };
}

function valueTarget(
  reader: Reader,
  flag: string,
  files: string[],
  code: string[],
): string[] | null | undefined {
  if (reader.fileFlags?.includes(flag)) return files;
  if (reader.codeFlag?.(flag)) return code;
  if (reader.skip?.includes(flag)) return null;
  return undefined;
}

function parse(reader: Reader, args: Args): ReadArgs {
  const files: string[] = [];
  const code: string[] = [];
  const positional: string[] = [];
  let firstGiven = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--') {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg);
      continue;
    }
    const { flag, inline } = flagParts(arg);
    if (reader.firstGivenBy?.includes(flag)) firstGiven = true;
    if (reader.pairs?.includes(flag)) {
      index += 2;
      continue;
    }
    const target = valueTarget(reader, flag, files, code);
    if (target === undefined) continue;
    const value = inline ?? args[++index];
    if (target && value !== undefined) target.push(value);
  }
  if (reader.first && !firstGiven && positional.length > 0) {
    const head = positional.shift()!;
    if (reader.first === 'code') code.push(head);
  }
  if (reader.dropLast && positional.length > 1) positional.pop();
  const mode = reader.positionalFiles ?? 'always';
  const positionalRead = mode === 'always' || (mode === 'with-code' && code.length > 0);
  if (positionalRead) files.push(...positional.filter((word) => word !== '-'));
  const recursive = reader.recursive?.(args) ?? false;
  if (recursive && reader.searchesHere && positional.length === 0) files.push('.');
  return {
    files,
    code,
    recursive,
    hidden: reader.hidden?.(args) ?? true,
    stdinCode: reader.stdinCode?.(args, positional, code) ?? false,
    include: reader.filters ? valuesOf(args, ['--include']) : [],
    exclude: reader.filters ? valuesOf(args, ['--exclude']) : [],
  };
}

export function readArgs(program: readonly string[]): ReadArgs | null {
  const name = programName(program);
  const args = program.slice(1);
  if (name === 'curl' || name === 'wget') return plainRead(fetchReads(name, args));
  if (name === 'dd') {
    return plainRead(args.filter((arg) => arg.startsWith('if=')).map((arg) => arg.slice(3)));
  }
  const reader = READERS.get(name);
  if (!reader) return null;
  if (name === 'rg' && args.includes('--files')) return null;
  return parse(reader, args);
}
