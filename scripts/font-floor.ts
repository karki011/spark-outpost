export const FONT_FLOOR_PX = 12;

const ROOT_FONT_PX = 16;
const LENGTH = /^(\d*\.?\d+)(px|rem)(?:\/|$)/i;
const IMPORTANT = /!\s*important\s*$/i;
const COMMENT = /\/\*[\s\S]*?\*\//g;
const QUOTED = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;

export interface SmallFont {
  line: number;
  selector: string;
  px: number;
}

export interface DecorativeFont {
  file: string;
  selector: string;
  why: string;
}

export const DECORATIVE_FONTS: DecorativeFont[] = [
  {
    file: 'apps/web/src/app/connection/connection.css',
    selector: '.offline-zz i:nth-child(3)',
    why: 'the smallest of three animated sleeping Zs',
  },
  {
    file: 'apps/web/src/app/connection/panic-scout.css',
    selector: '.ps-bang',
    why: 'an animated ! over the mascot, beside the written error',
  },
  {
    file: 'apps/web/src/map/build-stages.css',
    selector: '.bst.asleep .bst-blob::after',
    why: 'a z drawn on a sleeping blob, whose stage name says it',
  },
  {
    file: 'apps/web/src/tasks/task-list.css',
    selector: '.ic.errdot',
    why: 'the ! inside a 13px status icon that carries its own label',
  },
  {
    file: 'apps/web/src/island/island.css',
    selector: '.isl-pbadge',
    why: 'a hidden count dot on Scout; the strip says the count',
  },
  {
    file: 'apps/web/src/island/island-rest.css',
    selector: '.isl-aside',
    why: 'a hidden set-aside dot on Scout; the strip says the count',
  },
  {
    file: 'apps/web/src/island/island-peek-state.css',
    selector: '.isl-pb',
    why: 'a count dot on a chat blob; the chat row says it',
  },
];

function lengthPx(token: string): number | null {
  const match = LENGTH.exec(token);
  if (!match) return null;
  const size = Number(match[1]);
  return match[2]!.toLowerCase() === 'rem' ? size * ROOT_FONT_PX : size;
}

export function declaredFontPx(property: string, value: string): number | null {
  const tokens = value.replace(IMPORTANT, '').trim().split(/\s+/);
  if (property === 'font-size') return tokens.length === 1 ? lengthPx(tokens[0]!) : null;
  if (property !== 'font') return null;
  for (const token of tokens) {
    const px = lengthPx(token);
    if (px !== null) return px;
  }
  return null;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function declarations(body: string, start: number) {
  const found: { property: string; value: string; index: number }[] = [];
  let offset = start;
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) {
      const property = part.slice(0, colon).trim().toLowerCase();
      const lead = part.length - part.trimStart().length;
      found.push({ property, value: part.slice(colon + 1), index: offset + lead });
    }
    offset += part.length + 1;
  }
  return found;
}

export function isDecorative(file: string, selector: string): boolean {
  return DECORATIVE_FONTS.some((entry) => entry.file === file && entry.selector === selector);
}

function blankOut(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

export function findSmallFonts(text: string): SmallFont[] {
  const uncommented = text.replace(COMMENT, blankOut);
  const masked = uncommented.replace(QUOTED, blankOut);
  const small: SmallFont[] = [];
  const selectors: string[] = [];
  let segmentStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = masked[index];
    if (char !== '{' && char !== '}') continue;
    const segment = masked.slice(segmentStart, index);
    const check = (body: string, selector: string) => {
      for (const declaration of declarations(body, segmentStart)) {
        const px = declaredFontPx(declaration.property, declaration.value);
        if (px !== null && px < FONT_FLOOR_PX) {
          small.push({ line: lineAt(text, declaration.index), selector, px });
        }
      }
    };
    if (char === '{') {
      const lastBreak = segment.lastIndexOf(';');
      check(segment.slice(0, lastBreak + 1), selectors.at(-1) ?? '');
      selectors.push(
        uncommented
          .slice(segmentStart + lastBreak + 1, index)
          .trim()
          .replace(/\s+/g, ' '),
      );
    } else {
      check(segment, selectors.pop() ?? '');
    }
    segmentStart = index + 1;
  }
  return small.sort((a, b) => a.line - b.line);
}
