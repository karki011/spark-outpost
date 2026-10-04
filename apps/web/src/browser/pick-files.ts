import {
  UNTRUSTED_PAGE_NOTE,
  originAndPath,
  type BrowserPick,
  type PickedElement,
} from '@spark-outpost/contracts';

function box(element: Pick<PickedElement, 'box'>): string {
  const { x, y, width, height } = element.box;
  return `${Math.round(width)}×${Math.round(height)} at ${Math.round(x)},${Math.round(y)}`;
}

function describe(element: PickedElement, index: number, many: boolean): string {
  const styles = Object.entries(element.styles)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join('\n');
  return [
    many ? `Element ${index + 1}` : 'Element',
    `Role: ${element.role}${element.name ? ` "${element.name}"` : ''}`,
    `Box: ${box(element)}`,
    `HTML: ${element.html}`,
    ...(styles ? [`Computed styles:\n${styles}`] : []),
  ].join('\n');
}

export function pickText(pick: BrowserPick): string {
  const heading =
    pick.kind === 'element'
      ? 'The user selected this element in the browser pane.'
      : `The user selected a region in the browser pane (${box(pick)}).`;
  const elements = pick.elements.map((element, index) =>
    describe(element, index, pick.elements.length > 1),
  );
  return [
    heading,
    `Page: ${originAndPath(pick.url)}`,
    `Title: ${pick.title}`,
    UNTRUSTED_PAGE_NOTE,
    '',
    '<page_evidence>',
    ...elements.map((text) => text.replace(/<(\/?)page_evidence/gi, '<$1page-evidence')),
    '</page_evidence>',
  ].join('\n');
}

function slug(pick: BrowserPick): string {
  const first = pick.elements[0];
  const words = `${first?.role ?? pick.kind} ${first?.name ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return words || pick.kind;
}

function imageFile(dataUrl: string, name: string): File | null {
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[2]!), (char) => char.charCodeAt(0));
  const extension = match[1] === 'image/jpeg' ? 'jpg' : 'png';
  return new File([bytes], `${name}.${extension}`, { type: match[1]! });
}

export function pickFiles(pick: BrowserPick): File[] {
  const name = `selected-${slug(pick)}`;
  const text = new File([pickText(pick)], `${name}.txt`, { type: 'text/plain' });
  const image = pick.image ? imageFile(pick.image, name) : null;
  return image ? [text, image] : [text];
}
