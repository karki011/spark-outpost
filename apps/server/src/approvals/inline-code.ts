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
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?:\n|$)/g;

function count(code: string, pattern: RegExp): number {
  return [...code.matchAll(pattern)].length;
}

export function readsUnknownFiles(code: string): boolean {
  if (LISTING.test(code) || COMPUTED_GETLINE.test(code)) return true;
  if (count(code, READ_CALL) > count(code, LITERAL_READ_CALL)) return true;
  return count(code, PATH_READ) > count(code, LITERAL_PATH_READ);
}

export function heredocBodies(command: string): string[] {
  return [...command.matchAll(HEREDOC)].map((match) => match[3]!);
}
