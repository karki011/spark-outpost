export const TERMINAL_FONT_SIZE = 12.5;
const FONT_TOKEN = '--font-mono';
const SYSTEM_FONT = 'ui-monospace, Menlo, monospace';
const REMEASURE_SUFFIX = ', monospace';

interface FontTerminal {
  options: { fontFamily?: string };
  clearTextureAtlas(): void;
}

type Fonts = Pick<FontFaceSet, 'check' | 'load' | 'addEventListener' | 'removeEventListener'>;

const pageFonts = (): Fonts | undefined => document.fonts;

function unquoted(family: string): string {
  return family.trim().replace(/^["']|["']$/g, '');
}

function fontSpecs(font: string): string[] {
  const family = unquoted(font.split(',')[0] ?? '');
  return ['', 'bold '].map((weight) => `${weight}${TERMINAL_FONT_SIZE}px "${family}"`);
}

export function terminalFont(element: Element = document.documentElement): string {
  return getComputedStyle(element).getPropertyValue(FONT_TOKEN).trim() || SYSTEM_FONT;
}

export function warmTerminalFont(fonts: Fonts | undefined = pageFonts()): void {
  if (!fonts) return;
  for (const spec of fontSpecs(terminalFont())) void fonts.load(spec).catch(() => undefined);
}

export function refitWhenFontLoads(
  terminal: FontTerminal,
  refit: () => void,
  fonts: Fonts | undefined = pageFonts(),
): () => void {
  const font = terminal.options.fontFamily;
  if (!fonts || !font) return () => undefined;
  const family = unquoted(font.split(',')[0] ?? '');
  let following = true;
  const redraw = () => {
    if (!following) return;
    const current = terminal.options.fontFamily;
    terminal.options.fontFamily = current === font ? `${font}${REMEASURE_SUFFIX}` : font;
    terminal.clearTextureAtlas();
    refit();
  };
  const faceLoaded = (event: Event) => {
    const faces = (event as FontFaceSetLoadEvent).fontfaces;
    if (faces.some((face) => unquoted(face.family) === family)) redraw();
  };
  fonts.addEventListener('loadingdone', faceLoaded);
  for (const spec of fontSpecs(font)) {
    if (!fonts.check(spec)) void fonts.load(spec).then(redraw, () => undefined);
  }
  return () => {
    following = false;
    fonts.removeEventListener('loadingdone', faceLoaded);
  };
}
