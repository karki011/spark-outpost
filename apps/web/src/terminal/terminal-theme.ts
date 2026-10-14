import type { ITheme } from '@xterm/xterm';
import type { TerminalColors } from '@spark-outpost/contracts';

const BACKGROUND_TOKEN = '--code';
const FOREGROUND_TOKEN = '--text';
const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const LONG_HEX = /^#[0-9a-f]{6}$/i;

function token(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

export function themeFromTokens(element: Element = document.documentElement): ITheme {
  const styles = getComputedStyle(element);
  const light = styles.colorScheme.includes('light') && !styles.colorScheme.includes('dark');
  const theme: ITheme = {
    background: token(styles, BACKGROUND_TOKEN),
    foreground: token(styles, FOREGROUND_TOKEN),
    cursor: token(styles, '--accent'),
    cursorAccent: token(styles, BACKGROUND_TOKEN),
    selectionBackground: token(styles, '--accent-soft'),
    red: token(styles, '--danger'),
    brightRed: token(styles, '--danger'),
    green: token(styles, '--accent'),
    brightGreen: token(styles, '--accent'),
    yellow: token(styles, '--warn'),
    brightYellow: token(styles, '--warn'),
    brightBlack: token(styles, '--faint'),
  };
  if (!light) return theme;
  return {
    ...theme,
    white: token(styles, '--muted'),
    brightWhite: token(styles, FOREGROUND_TOKEN),
  };
}

function sixDigitHex(color: string): string | null {
  if (LONG_HEX.test(color)) return color.toLowerCase();
  const short = SHORT_HEX.exec(color);
  if (!short) return null;
  const [red, green, blue] = short.slice(1).map((digit) => digit.repeat(2));
  return `#${red}${green}${blue}`.toLowerCase();
}

export function colorsFromTokens(
  element: Element = document.documentElement,
): TerminalColors | null {
  const styles = getComputedStyle(element);
  const foreground = sixDigitHex(token(styles, FOREGROUND_TOKEN));
  const background = sixDigitHex(token(styles, BACKGROUND_TOKEN));
  return foreground && background ? { foreground, background } : null;
}
