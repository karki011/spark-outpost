export interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEY_LINE = /^([A-Za-z][\w-]*):[ \t]*(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return quoted ? quoted[2]! : trimmed;
}

function blockValue(marker: string, lines: string[]): string {
  const parts = lines.map((line) => line.trim());
  if (marker.startsWith('|')) return parts.join('\n').trim();
  if (parts.every((part) => part.startsWith('- '))) {
    return parts.map((part) => unquote(part.slice(2))).join(', ');
  }
  return parts.join(' ').trim();
}

export function parseFrontmatter(text: string): Frontmatter {
  const match = FENCE.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  let key: string | null = null;
  let marker = '';
  let block: string[] = [];
  const flush = () => {
    if (key && block.length > 0) fields[key] = blockValue(marker, block);
    block = [];
  };
  for (const line of match[1]!.split(/\r?\n/)) {
    const entry = KEY_LINE.exec(line);
    if (entry && !/^\s/.test(line)) {
      flush();
      key = entry[1]!;
      marker = entry[2]!.trim();
      if (marker === '' || marker === '|' || marker === '>' || /^[|>][-+]?$/.test(marker)) {
        fields[key] = '';
      } else {
        fields[key] = unquote(marker);
        key = null;
      }
      continue;
    }
    if (key && line.trim() !== '') block.push(line);
  }
  flush();
  return { fields, body: text.slice(match[0].length) };
}

export function renderFrontmatter(fields: Record<string, string>, body: string): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
