import type { HighlighterCore } from 'shiki/core';

const LANGUAGES = {
  bash: () => import('shiki/langs/bash.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
} as const;

export type Language = keyof typeof LANGUAGES;

const ALIASES: Record<string, Language> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  htm: 'html',
  py: 'python',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown',
  patch: 'diff',
};

export const THEME_NAME = 'spark-outpost';

export function languageForPath(path: string): Language | null {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? resolveLanguage(name.slice(dot + 1)) : null;
}

export function resolveLanguage(name: string | undefined): Language | null {
  if (!name) return null;
  const key = name.toLowerCase();
  if (key in LANGUAGES) return key as Language;
  return ALIASES[key] ?? null;
}

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Set<Language>();

async function createHighlighter(): Promise<HighlighterCore> {
  const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
    await Promise.all([import('shiki/core'), import('shiki/engine/javascript')]);
  return createHighlighterCore({
    themes: [createCssVariablesTheme({ name: THEME_NAME, variablePrefix: '--code-' })],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
}

async function ready(language: Language): Promise<HighlighterCore> {
  highlighter ??= createHighlighter();
  const instance = await highlighter;
  if (!loaded.has(language)) {
    await instance.loadLanguage((await LANGUAGES[language]()).default);
    loaded.add(language);
  }
  return instance;
}

export async function highlight(code: string, language: Language): Promise<string> {
  const instance = await ready(language);
  return instance.codeToHtml(code, { lang: language, theme: THEME_NAME });
}

export interface CodeToken {
  content: string;
  color: string | undefined;
}

export async function highlightLines(code: string, language: Language): Promise<CodeToken[][]> {
  const instance = await ready(language);
  return instance
    .codeToTokensBase(code, { lang: language, theme: THEME_NAME })
    .map((line) => line.map(({ content, color }) => ({ content, color })));
}
