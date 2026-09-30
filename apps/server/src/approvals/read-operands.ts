const GIT_READS = new Set(['status', 'diff', 'log', 'show', 'branch']);
const GIT_BRANCH_FLAGS = new Set(['-a', '-r', '-v', '-vv', '--all', '--list', '--show-current']);
const RECURSIVE_GREP = new Set(['-r', '-R', '--recursive', '--dereference-recursive']);
const GREP_VALUE_FLAGS = new Set([
  '-e',
  '--regexp',
  '-m',
  '--max-count',
  '-A',
  '-B',
  '-C',
  '--context',
]);
const GREP_FILE_FLAGS = new Set(['-f', '--file']);
const GREP_PATTERN_FLAGS = new Set(['-e', '--regexp', ...GREP_FILE_FLAGS]);
const FIND_ACTIONS = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
]);
const SED_FLAGS = new Set(['-n', '-E', '-r', '-s', '--quiet', '--silent']);
const SED_SCRIPT_FLAGS = new Set(['-e', '--expression']);
const SED_ADDRESS = String.raw`(?:\d+|\$|/(?:[^/\\\n]|\\.)*/)`;
const SED_RANGE = `(?:${SED_ADDRESS}(?:,${SED_ADDRESS})?)?`;
const SED_COMMAND = new RegExp(`^${SED_RANGE}(?:[pdq=]|\\d+q)$`);
const SED_SUBSTITUTE = new RegExp(`^${SED_RANGE}s`);
const SED_SUBSTITUTE_FLAGS = /^[gIip\d]*$/;
const AWK_VALUE_FLAGS = new Set(['-F', '-v']);
const AWK_RUNS = /\b(?:system|getline|close|fflush)\b|\bprintf?\b[^;}]*[>|]/;
const JQ_PAIR_FLAGS = new Set(['--arg', '--argjson']);
const JQ_FILE_PAIR_FLAGS = new Set(['--slurpfile', '--rawfile']);
const JQ_FILE_FLAGS = new Set(['-f', '--from-file']);
const RG_REFUSED = /^(?:--pre|--pre-glob|-z|--search-zip|-f|--file|--files|--ignore-file)(?:=|$)/;
const SORT_WRITES = /^(?:-o|--output|--compress-program)/;

export const LISTERS: ReadonlySet<string> = new Set(['ls', 'pwd', 'stat', 'tree', 'find', 'wc']);

const isFlag = (token: string) => token.startsWith('-');

export function grepRecurses(args: readonly string[]): boolean {
  return args.some((arg) => RECURSIVE_GREP.has(arg) || /^-[a-zA-Z]*[rR]/.test(arg));
}

function flagValue(token: string): string | null {
  const equals = token.indexOf('=');
  return token.startsWith('--') && equals > 0 ? token.slice(equals + 1) : null;
}

function plainOperands(args: readonly string[]): string[] {
  const values = args.map(flagValue).filter((value): value is string => value !== null);
  return [...args.filter((arg) => !isFlag(arg)), ...values];
}

function gitOperands(args: readonly string[]): string[] | null {
  const [subcommand, ...rest] = args;
  if (!subcommand || !GIT_READS.has(subcommand)) return null;
  if (rest.some((arg) => arg === '--output' || arg.startsWith('--output=') || arg.includes(':'))) {
    return null;
  }
  if (subcommand === 'branch' && !rest.every((arg) => GIT_BRANCH_FLAGS.has(arg))) return null;
  return rest.filter((arg) => !isFlag(arg) && arg !== '--');
}

function grepOperands(args: readonly string[]): string[] | null {
  if (grepRecurses(args)) return null;
  let patternGiven = args.some(
    (arg) => GREP_PATTERN_FLAGS.has(arg) || /^--(?:regexp|file)=/.test(arg),
  );
  const files: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (GREP_VALUE_FLAGS.has(arg)) index++;
    else if (GREP_FILE_FLAGS.has(arg)) files.push(args[++index] ?? '');
    else if (arg.startsWith('--file=')) files.push(flagValue(arg)!);
    else if (isFlag(arg)) continue;
    else if (patternGiven) files.push(arg);
    else patternGiven = true;
  }
  return files;
}

function sedSubstitutes(script: string): boolean {
  const start = SED_SUBSTITUTE.exec(script);
  if (!start) return false;
  const delimiter = script[start[0].length];
  if (!delimiter || /[\s\\\w]/.test(delimiter)) return false;
  const parts: string[] = [''];
  for (let index = start[0].length + 1; index < script.length; index++) {
    const char = script[index]!;
    if (char === '\\') parts[parts.length - 1] += char + (script[++index] ?? '');
    else if (char === delimiter) parts.push('');
    else parts[parts.length - 1] += char;
  }
  return parts.length === 3 && SED_SUBSTITUTE_FLAGS.test(parts[2]!);
}

function sedScriptIsRead(script: string): boolean {
  if (script.includes('\n') || script.includes(';')) return false;
  return SED_COMMAND.test(script) || sedSubstitutes(script);
}

function sedOperands(args: readonly string[]): string[] | null {
  const scripts: string[] = [];
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (SED_SCRIPT_FLAGS.has(arg)) scripts.push(args[++index] ?? '');
    else if (arg.startsWith('--expression=')) scripts.push(flagValue(arg)!);
    else if (SED_FLAGS.has(arg)) continue;
    else if (isFlag(arg)) return null;
    else positional.push(arg);
  }
  const files = scripts.length > 0 ? positional : positional.slice(1);
  if (scripts.length === 0) scripts.push(positional[0] ?? '');
  return scripts.every(sedScriptIsRead) ? files : null;
}

function awkOperands(args: readonly string[]): string[] | null {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (AWK_VALUE_FLAGS.has(arg)) index++;
    else if (/^-[Fv]./.test(arg)) continue;
    else if (isFlag(arg)) return null;
    else positional.push(arg);
  }
  const [code, ...files] = positional;
  return code !== undefined && !AWK_RUNS.test(code) ? files : null;
}

function jqOperands(args: readonly string[]): string[] {
  const files: string[] = [];
  let filterGiven = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (JQ_PAIR_FLAGS.has(arg)) index += 2;
    else if (JQ_FILE_PAIR_FLAGS.has(arg)) {
      files.push(args[index + 2] ?? '');
      index += 2;
    } else if (JQ_FILE_FLAGS.has(arg)) {
      files.push(args[++index] ?? '');
      filterGiven = true;
    } else if (isFlag(arg)) continue;
    else if (filterGiven) files.push(arg);
    else filterGiven = true;
  }
  return files;
}

function rgOperands(args: readonly string[], piped: boolean): string[] | null {
  if (!piped || args.some((arg) => RG_REFUSED.test(arg))) return null;
  return args.filter((arg) => !isFlag(arg)).length <= 1 ? [] : null;
}

export function readOperands(
  program: string,
  args: readonly string[],
  piped: boolean,
): string[] | null {
  switch (program) {
    case 'ls':
    case 'pwd':
    case 'stat':
    case 'wc':
    case 'cat':
    case 'head':
    case 'tail':
    case 'cut':
    case 'nl':
      return plainOperands(args);
    case 'find':
      return args.some((arg) => FIND_ACTIONS.has(arg)) ? null : plainOperands(args);
    case 'tree':
      return args.some((arg) => arg.startsWith('-o')) ? null : plainOperands(args);
    case 'sort':
      return args.some((arg) => SORT_WRITES.test(arg)) ? null : plainOperands(args);
    case 'uniq':
      return args.filter((arg) => !isFlag(arg)).length <= 1 ? plainOperands(args) : null;
    case 'tr':
      return [];
    case 'git':
      return gitOperands(args);
    case 'grep':
      return grepOperands(args);
    case 'sed':
      return sedOperands(args);
    case 'awk':
      return awkOperands(args);
    case 'jq':
      return jqOperands(args);
    case 'rg':
      return rgOperands(args, piped);
    default:
      return null;
  }
}
