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

const PICK_HEADING = 'The user selected ';
const PICK_TEXT_NAME = /^(selected-[a-z0-9-]+)\.txt$/;

export function pickLabel(text: string): string | null {
  if (!text.startsWith(PICK_HEADING)) return null;
  if (text.startsWith(`${PICK_HEADING}a region`)) return 'Selected region';
  const element = /^Role: (.+?)(?: "(.*)")?$/m.exec(text);
  if (!element) return 'Selected element';
  const [, role, name] = element;
  return name ? `Selected: ${name} ${role}` : `Selected: ${role}`;
}

interface NamedFile {
  name: string;
  kind: string | null;
}

export interface PickPair<T> {
  text: T;
  image: T | null;
}

export function groupPicks<T extends NamedFile>(files: readonly T[]): (T | PickPair<T>)[] {
  const paired = new Set<T>();
  const grouped: (T | PickPair<T>)[] = [];
  for (const file of files) {
    if (paired.has(file)) continue;
    const base = file.kind === 'text' ? PICK_TEXT_NAME.exec(file.name)?.[1] : undefined;
    if (!base) {
      grouped.push(file);
      continue;
    }
    const image =
      files.find(
        (other) =>
          other.kind === 'image' &&
          !paired.has(other) &&
          (other.name === `${base}.png` || other.name === `${base}.jpg`),
      ) ?? null;
    if (image) paired.add(image);
    grouped.push({ text: file, image });
  }
  return grouped.filter((entry) => 'text' in entry || !paired.has(entry));
}
