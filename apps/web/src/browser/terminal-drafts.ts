import type { BrowserPick, BrowserSelectedText, PickedElement } from '@spark-outpost/contracts';
import { evidence, pageLines, pickHeading, selectedTextHeading } from './pick-files.ts';

const HTML_MAX = 300;
const ELEMENTS_MAX = 3;

function shortElement(element: PickedElement): string {
  const name = element.name ? ` "${element.name}"` : '';
  const html =
    element.html.length <= HTML_MAX ? element.html : `${element.html.slice(0, HTML_MAX - 1)}…`;
  return `Element: ${element.role}${name}\nHTML: ${html}`;
}

export function pickDraft(pick: BrowserPick, picture: string | null): string {
  const shown = pick.elements.slice(0, ELEMENTS_MAX).map(shortElement);
  const more = pick.elements.length - shown.length;
  const rest = more > 0 ? [`And ${more} more ${more === 1 ? 'element' : 'elements'}.`] : [];
  return [
    pickHeading(pick),
    ...pageLines(pick),
    ...evidence([...shown, ...rest]),
    ...(picture ? [`Picture: ${JSON.stringify(picture)}`] : []),
  ].join('\n');
}

export function selectedTextDraft(selected: BrowserSelectedText): string {
  return [selectedTextHeading(selected), ...pageLines(selected), ...evidence([selected.text])].join(
    '\n',
  );
}
