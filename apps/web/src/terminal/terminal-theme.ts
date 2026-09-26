import type { ITheme } from '@xterm/xterm';

function token(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

export function themeFromTokens(element: Element = document.documentElement): ITheme {
  const styles = getComputedStyle(element);
  const light = styles.colorScheme.includes('light') && !styles.colorScheme.includes('dark');
  const theme: ITheme = {
    background: token(styles, '--code'),
    foreground: token(styles, '--text'),
    cursor: token(styles, '--accent'),
    cursorAccent: token(styles, '--code'),
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
  return { ...theme, white: token(styles, '--muted'), brightWhite: token(styles, '--text') };
}
