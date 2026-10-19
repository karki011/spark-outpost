const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const SAFE_LINK = /^https?:\/\/[^\s"<>]+$/i;

function inline(text: string): string {
  const parts: string[] = [];
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(escapeXml(text.slice(last, match.index)));
    const [whole, code, label, href, bold, star, under] = match;
    if (code !== undefined) parts.push(`<code>${escapeXml(code)}</code>`);
    else if (label !== undefined && href !== undefined && SAFE_LINK.test(href)) {
      parts.push(`<a href="${escapeXml(href)}">${escapeXml(label)}</a>`);
    } else if (bold !== undefined) parts.push(`<strong>${escapeXml(bold)}</strong>`);
    else if (star !== undefined) parts.push(`<em>${escapeXml(star)}</em>`);
    else if (under !== undefined) parts.push(`<em>${escapeXml(under)}</em>`);
    else parts.push(escapeXml(whole));
    last = match.index + whole.length;
  }
  parts.push(escapeXml(text.slice(last)));
  return parts.join('');
}

interface Block {
  kind: 'p' | 'ul' | 'ol' | 'quote';
  lines: string[];
}

function listItem(line: string): { kind: 'ul' | 'ol'; text: string } | null {
  const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
  if (bullet) return { kind: 'ul', text: bullet[1]! };
  const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
  return numbered ? { kind: 'ol', text: numbered[1]! } : null;
}

function closeBlock(block: Block | null): string {
  if (!block) return '';
  if (block.kind === 'p') return `<p>${block.lines.map(inline).join('<br />')}</p>`;
  if (block.kind === 'quote') {
    return `<blockquote><p>${block.lines.map(inline).join('<br />')}</p></blockquote>`;
  }
  const items = block.lines.map((line) => `<li>${inline(line)}</li>`).join('');
  return `<${block.kind}>${items}</${block.kind}>`;
}

export function markdownToStorage(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  let block = null as Block | null;
  let fence: string[] | null = null;
  const flush = () => {
    out.push(closeBlock(block));
    block = null;
  };
  for (const line of lines) {
    if (fence) {
      if (/^\s*```/.test(line)) {
        out.push(`<pre>${escapeXml(fence.join('\n'))}</pre>`);
        fence = null;
      } else fence.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      fence = [];
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = listItem(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (line.trim() === '') flush();
    else if (heading) {
      flush();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!.trim())}</h${level}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push('<hr />');
    } else if (item) {
      if (block?.kind !== item.kind) flush();
      block ??= { kind: item.kind, lines: [] };
      block.lines.push(item.text);
    } else if (quote) {
      if (block?.kind !== 'quote') flush();
      block ??= { kind: 'quote', lines: [] };
      block.lines.push(quote[1]!);
    } else {
      if (block?.kind !== 'p') flush();
      block ??= { kind: 'p', lines: [] };
      block.lines.push(line.trim());
    }
  }
  if (fence) out.push(`<pre>${escapeXml(fence.join('\n'))}</pre>`);
  flush();
  return out.join('');
}

const BLOCK_BREAK = /<\/?(p|div|h[1-6]|ul|ol|table|tbody|thead|blockquote|hr|tr)\b[^>]*>/gi;

export function storageToText(storage: string): string {
  const text = storage
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_whole, body: string) => escapeXml(body))
    .replace(/<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>/gi, '\n```\n$1\n```\n')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
    .replace(/<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/gi, '')
    .replace(/<h([1-6])\b[^>]*>/gi, (_whole, level: string) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(t[dh])\b[^>]*>/gi, ' | ')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<\/?(strong|b)\b[^>]*>/gi, '**')
    .replace(/<\/?(em|i)\b[^>]*>/gi, '*')
    .replace(/<\/?code\b[^>]*>/gi, '`')
    .replace(BLOCK_BREAK, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
