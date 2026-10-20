import { descriptionParts } from './description-parts.ts';

const MARKDOWN_CHARS = /[\\`*_{}[\]()#+\-.!|<>~&=:]/g;
const LIST_LINE = /^( *)(•|\d{1,9}\.) +(.*)$/;
const LIST_INDENT = '    ';

interface Line {
  list: boolean;
  text: string;
}

function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_CHARS, (char) => `\\${char}`);
}

function inline(text: string): string {
  return descriptionParts(text)
    .map((part) => (part.kind === 'link' ? `<${part.url}>` : escapeMarkdown(part.text)))
    .join('');
}

function toLine(raw: string): Line {
  const item = LIST_LINE.exec(raw);
  if (!item) return { list: false, text: inline(raw.trim()) };
  const level = Math.floor(item[1]!.length / 2);
  const marker = item[2] === '•' ? '-' : item[2]!;
  return { list: true, text: `${LIST_INDENT.repeat(level)}${marker} ${inline(item[3]!)}` };
}

export function agendaMarkdown(agenda: string): string {
  const lines = agenda.split(/\r?\n/).map(toLine);
  const out: string[] = [];
  lines.forEach((line, index) => {
    const next = lines[index + 1];
    out.push(line.text);
    if (!next || !line.text || !next.text) return;
    if (line.list !== next.list) out.push('');
    else if (!line.list) out[out.length - 1] += '\\';
  });
  return out.join('\n');
}
