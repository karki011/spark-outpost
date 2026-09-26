export interface Mention {
  start: number;
  end: number;
  query: string;
}

const MENTION_BEFORE_CARET = /(?:^|\s)@([^\s@]*)$/;

export function findMention(text: string, caret: number): Mention | null {
  const match = MENTION_BEFORE_CARET.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[1] ?? '';
  return { start: caret - query.length - 1, end: caret, query };
}

export function removeMention(text: string, mention: Mention): string {
  return text.slice(0, mention.start) + text.slice(mention.end);
}

const MIRRORED_STYLES = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderLeftWidth',
  'borderRightWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'tabSize',
  'textTransform',
  'wordSpacing',
] as const;

export function caretLeft(textarea: HTMLTextAreaElement, index: number): number {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const property of MIRRORED_STYLES) mirror.style[property] = style[property];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.append(marker);
  document.body.append(mirror);
  const left = marker.offsetLeft - textarea.scrollLeft;
  mirror.remove();
  return left;
}
