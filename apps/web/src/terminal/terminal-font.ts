export const TERMINAL_FONT = '"Geist Mono", ui-monospace, Menlo, monospace';
export const TERMINAL_FONT_SIZE = 12.5;
const LOADED_FONT = `${TERMINAL_FONT}, monospace`;
const FONT_SPEC = `${TERMINAL_FONT_SIZE}px "Geist Mono"`;

interface FontTerminal {
  options: { fontFamily?: string };
}

type Fonts = Pick<FontFaceSet, 'check' | 'load'>;

export function refitWhenFontLoads(
  terminal: FontTerminal,
  alive: () => boolean,
  refit: () => void,
  fonts: Fonts | undefined = document.fonts,
): void {
  if (!fonts || fonts.check(FONT_SPEC)) return;
  void fonts.load(FONT_SPEC).then(
    () => {
      if (!alive()) return;
      terminal.options.fontFamily = LOADED_FONT;
      refit();
    },
    () => undefined,
  );
}
