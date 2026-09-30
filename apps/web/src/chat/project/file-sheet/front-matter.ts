export interface FrontMatter {
  properties: [string, string][];
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const PROPERTY = /^([\w.-]+):\s*(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote) && trimmed.length > 1) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function splitFrontMatter(text: string): FrontMatter {
  const match = FENCE.exec(text);
  if (!match) return { properties: [], body: text };
  const properties: [string, string][] = [];
  for (const line of match[1]!.split(/\r?\n/)) {
    const property = PROPERTY.exec(line);
    if (property) {
      properties.push([property[1]!, unquote(property[2]!)]);
      continue;
    }
    const last = properties.at(-1);
    const extra = line.trim().replace(/^-\s+/, '');
    if (last && extra)
      last[1] = last[1] && !/^[>|]-?$/.test(last[1]) ? `${last[1]} ${extra}` : extra;
  }
  return { properties, body: text.slice(match[0].length) };
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sh: 'bash',
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  py: 'python',
};

export function isMarkdown(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

export function languageOf(path: string): string | undefined {
  if (isMarkdown(path)) return 'markdown';
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_BY_EXTENSION[extension];
}
