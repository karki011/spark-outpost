export const SYMBOL_LANGUAGES = [
  'typescript',
  'tsx',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'c-sharp',
  'cpp',
  'ruby',
  'php',
  'bash',
] as const;

export type SymbolLanguage = (typeof SYMBOL_LANGUAGES)[number];

const BY_EXTENSION: Record<string, SymbolLanguage> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'c-sharp',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
};

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function symbolLanguage(path: string): SymbolLanguage | null {
  return BY_EXTENSION[extensionOf(path)] ?? null;
}
