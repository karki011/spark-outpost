const THEME_NAME = /^[a-z]{1,24}(\.[a-z]{1,24}){0,2}$/;
const THEME_ARG = '--spark-theme=';

export function isThemeName(value: unknown): value is string {
  return typeof value === 'string' && THEME_NAME.test(value);
}

export function themeArgs(theme: string | null): string[] {
  return theme ? [`${THEME_ARG}${theme}`] : [];
}

export function themeFromArgs(argv: readonly string[]): string | null {
  const value = argv.find((arg) => arg.startsWith(THEME_ARG))?.slice(THEME_ARG.length);
  return isThemeName(value) ? value : null;
}
