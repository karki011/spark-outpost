import { readFileSync } from 'node:fs';
import { parseColor, type Rgba } from './color.ts';

export type Tokens = Map<string, string>;
type Block = { selector: string; media: string | undefined; declarations: Tokens };

export const THEME_CSS = [
  'apps/web/public/theme-base.css',
  'apps/web/public/theme-bold.css',
  'apps/web/public/theme.css',
  'apps/web/public/theme-map.css',
];
export const COMPONENT_TOKEN_CSS = ['apps/web/src/chat/markdown/code-tokens.css'];

export const THEMES = [
  'system-light',
  'system-dark',
  'light',
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'aurora',
  'iris',
  'loam',
  'blaze',
  'ember',
  'acid',
  'volt',
  'violet',
  'ultra',
  'contrast',
  'contrast-dark',
] as const;
export type ThemeId = (typeof THEMES)[number];

function readDeclarations(body: string): Tokens {
  const declarations: Tokens = new Map();
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name && value) declarations.set(name, value.trim().replace(/\s+/g, ' '));
  }
  return declarations;
}

export function parseBlocks(css: string, media?: string): Block[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '');
  const blocks: Block[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor);
    if (open === -1) break;
    const prelude = source.slice(cursor, open).trim();
    let depth = 1;
    let close = open + 1;
    while (depth > 0 && close < source.length) {
      if (source[close] === '{') depth++;
      if (source[close] === '}') depth--;
      close++;
    }
    const body = source.slice(open + 1, close - 1);
    if (prelude.startsWith('@media')) blocks.push(...parseBlocks(body, prelude));
    else
      blocks.push({
        selector: prelude.replace(/\s+/g, ' '),
        media,
        declarations: readDeclarations(body),
      });
    cursor = close;
  }
  return blocks;
}

function selectorsOf(block: Block): string[] {
  return block.selector.split(',').map((s) => s.trim());
}

function matchesTheme(block: Block, theme: ThemeId): boolean {
  const selectors = selectorsOf(block);
  const isDarkMedia = block.media?.includes('prefers-color-scheme: dark') ?? false;
  if (selectors.includes(':root') && !block.media) return true;
  if (theme === 'system-dark') return isDarkMedia && selectors.includes(':root:not([data-skin])');
  if (theme.startsWith('system') || block.media) return false;
  return selectors.includes(`[data-skin='${theme}']`);
}

export function themeTokens(theme: ThemeId, root = process.cwd()): Tokens {
  const tokens: Tokens = new Map();
  const blocks = THEME_CSS.flatMap((file) => parseBlocks(readFileSync(`${root}/${file}`, 'utf8')));
  for (const block of blocks) {
    if (!matchesTheme(block, theme)) continue;
    for (const [name, value] of block.declarations) tokens.set(name, value);
  }
  for (const file of COMPONENT_TOKEN_CSS) {
    for (const block of parseBlocks(readFileSync(`${root}/${file}`, 'utf8'))) {
      if (block.media) continue;
      for (const [name, value] of block.declarations) tokens.set(name, value);
    }
  }
  return tokens;
}

export function resolver(tokens: Tokens): (expr: string) => Rgba {
  const resolve = (expr: string, seen: Set<string> = new Set()): Rgba => {
    const trimmed = expr.trim();
    const variable = trimmed.match(/^var\((--[\w-]+)(?:\s*,\s*(.+))?\)$/s);
    if (!variable) return parseColor(trimmed, (inner) => resolve(inner, seen));
    const name = variable[1] ?? '';
    const fallback = variable[2];
    if (seen.has(name)) throw new Error(`Cyclic token ${name}`);
    const value = tokens.get(name) ?? fallback;
    if (value === undefined) throw new Error(`Unknown token ${name}`);
    return resolve(value, new Set([...seen, name]));
  };
  return (expr) => resolve(expr);
}
