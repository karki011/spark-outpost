const READ_FUNCTIONS =
  'open|readFileSync|readFile|readTextFile|readTextFileSync|createReadStream|file_get_contents|fopen|File\\.read|IO\\.read|File\\.open|Bun\\.file';
const READ_CALL = new RegExp(`\\b(?:${READ_FUNCTIONS})\\s*\\(`, 'g');
const LITERAL_READ_CALL = new RegExp(
  `\\b(?:${READ_FUNCTIONS})\\s*\\(\\s*(['"])[^'"$\`{}*?]*\\1`,
  'g',
);
const PATH_READ = /\.read_(?:text|bytes)\s*\(/g;
const LITERAL_PATH_READ = /Path\(\s*(['"])[^'"$`{}*?]*\1\s*\)\.read_(?:text|bytes)\s*\(/g;
const LISTING =
  /\b(?:listdir|readdirSync|readdir|scandir|os\.walk|glob|iglob|iterdir|rglob|opendir|Dir\.glob|Dir\.entries)\b|\bDir\[/;
const COMPUTED_GETLINE = /\bgetline\b[^<;}\n]*<\s*[^"'\s]/;
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1([^\n]*)\n([\s\S]*?)\n[ \t]*\2[ \t]*(?:\n|$)/g;
const HERESTRING = /<<<\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)"|([^\s;&|<>()]+))/g;
const ENV_FILE_LOADERS = /\b(?:load_dotenv|dotenv_values|dotenv|loadEnvFile|Dotenv)\b|--env-file/;

function count(code: string, pattern: RegExp): number {
  return [...code.matchAll(pattern)].length;
}

export function readsUnknownFiles(code: string): boolean {
  if (LISTING.test(code) || COMPUTED_GETLINE.test(code)) return true;
  if (count(code, READ_CALL) > count(code, LITERAL_READ_CALL)) return true;
  return count(code, PATH_READ) > count(code, LITERAL_PATH_READ);
}

export function loadsEnvFile(code: string): boolean {
  return ENV_FILE_LOADERS.test(code);
}

export function heredocBodies(command: string): string[] {
  return [...command.matchAll(HEREDOC)].map((match) => match[4]!);
}

export function heredocBodySpans(command: string): [number, number][] {
  return [...command.matchAll(HEREDOC)].map((match) => {
    const start = match.index + match[0].indexOf('\n') + 1;
    return [start, start + match[4]!.length];
  });
}

export function withoutHereText(command: string): string {
  return command
    .replace(HEREDOC, (_match, _quote, _word, rest: string) => ` ${rest}\n`)
    .replace(HERESTRING, ' ');
}

const RUNS_HERE_TEXT =
  /(?:^|[\s;&|(])(?:sh|bash|zsh|dash|ksh|fish|python[\d.]*|node|ruby|perl|php|ssh|eval|xargs|sudo|env)\b/;

export function withoutDataHeredocs(command: string): string {
  return command.replace(HEREDOC, (match: string, ...groups: unknown[]) => {
    const offset = groups.at(-2) as number;
    const line = command.slice(command.lastIndexOf('\n', offset) + 1, offset);
    return RUNS_HERE_TEXT.test(line) ? match : ` ${String(groups[2])}\n`;
  });
}

export function herestrings(command: string): string[] {
  return [...command.matchAll(HERESTRING)].map(
    (match) => match[1] ?? match[2]?.replace(/\\(.)/g, '$1') ?? match[3]!,
  );
}
