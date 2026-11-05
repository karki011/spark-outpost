import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';

type Loader = () => Promise<LanguageSupport>;

const javascript =
  (options: { jsx?: boolean; typescript?: boolean }): Loader =>
  () =>
    import('@codemirror/lang-javascript').then((mod) => mod.javascript(options));

const LANGUAGES: Record<string, Loader> = {
  js: javascript({}),
  mjs: javascript({}),
  cjs: javascript({}),
  jsx: javascript({ jsx: true }),
  ts: javascript({ typescript: true }),
  mts: javascript({ typescript: true }),
  cts: javascript({ typescript: true }),
  tsx: javascript({ jsx: true, typescript: true }),
  css: () => import('@codemirror/lang-css').then((mod) => mod.css()),
  html: () => import('@codemirror/lang-html').then((mod) => mod.html()),
  htm: () => import('@codemirror/lang-html').then((mod) => mod.html()),
  json: () => import('@codemirror/lang-json').then((mod) => mod.json()),
  md: () => import('@codemirror/lang-markdown').then((mod) => mod.markdown()),
  py: () => import('@codemirror/lang-python').then((mod) => mod.python()),
  rs: () => import('@codemirror/lang-rust').then((mod) => mod.rust()),
  sql: () => import('@codemirror/lang-sql').then((mod) => mod.sql()),
  yml: () => import('@codemirror/lang-yaml').then((mod) => mod.yaml()),
  yaml: () => import('@codemirror/lang-yaml').then((mod) => mod.yaml()),
  go: () => import('@codemirror/lang-go').then((mod) => mod.go()),
  java: () => import('@codemirror/lang-java').then((mod) => mod.java()),
};

const loaded = new Map<string, LanguageSupport>();

function extensionOf(path: string): string | null {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? null : name.slice(dot + 1).toLowerCase();
}

export function loadedLanguage(path: string): LanguageSupport | null {
  return loaded.get(extensionOf(path) ?? '') ?? null;
}

export function languageLoader(path: string): Loader | null {
  const extension = extensionOf(path);
  const load = extension === null ? undefined : LANGUAGES[extension];
  if (!extension || !load) return null;
  return async () => {
    const language = await load();
    loaded.set(extension, language);
    return language;
  };
}

const token = (name: string) => `var(--code-token-${name})`;

const highlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword],
    color: token('keyword'),
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: token('string') },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom, tags.constant(tags.name)],
    color: token('constant'),
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: token('constant') },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: token('function'),
  },
  { tag: [tags.comment, tags.meta], color: token('comment'), fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.bracket, tags.operator], color: token('punctuation') },
  { tag: [tags.link, tags.url], color: token('link'), textDecoration: 'underline' },
  { tag: tags.heading, color: token('keyword'), fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600' },
]);

const WORD_TOKENS = [
  'comment',
  'keyword',
  'constant',
  'string',
  'string-expression',
  'function',
  'parameter',
  'punctuation',
  'link',
];
const wordTokens = Object.fromEntries(
  WORD_TOKENS.map((name) => [`--code-token-${name}`, `var(--code-word-${name})`]),
);
const SIGN = { position: 'absolute', left: '7px', userSelect: 'none' };

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--code-foreground)',
    backgroundColor: 'var(--code)',
    fontSize: '12.5px',
  },
  '.cm-scroller': {
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    lineHeight: '1.6',
    overscrollBehavior: 'contain',
  },
  '.cm-content': { caretColor: 'var(--text)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-gutters': {
    backgroundColor: 'var(--code)',
    color: 'var(--faint)',
    borderRight: '1px solid var(--line)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 26%, transparent) !important',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 30%, transparent)' },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--warn) 55%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--panel)',
    color: 'var(--text)',
    borderColor: 'var(--line)',
  },
  '.cm-panel input, .cm-panel button': { font: 'inherit', color: 'var(--text)' },
  '.cm-line, .cm-deletedChunk .cm-deletedLine': { position: 'relative', padding: '0 2px 0 22px' },
  '.cm-deletedChunk': { paddingLeft: '0', backgroundColor: 'var(--diff-remove)' },
  '.cm-changedLine': { backgroundColor: 'var(--diff-add)' },
  '&.cm-merge-a .cm-changedLine': { backgroundColor: 'var(--diff-remove)' },
  '.cm-insertedLine, .cm-deletedLine, .cm-deletedLine del': {
    background: 'none',
    textDecoration: 'none',
  },
  '.dd-word': { ...wordTokens, borderRadius: '3px', backgroundColor: 'var(--diff-add-word)' },
  '&.cm-merge-a .dd-word, .cm-deletedChunk .dd-word': {
    backgroundColor: 'var(--diff-remove-word)',
  },
  '.cm-changedLine::before, &.dd-new .cm-line::before': {
    ...SIGN,
    content: '"+"',
    color: 'var(--success)',
  },
  '.cm-deletedChunk .cm-deletedLine::before, &.cm-merge-a .cm-changedLine::before, &.dd-gone .cm-line::before':
    {
      ...SIGN,
      content: '"−"',
      color: 'var(--danger)',
    },
  '&.dd-new .cm-line': { backgroundColor: 'var(--diff-add)' },
  '&.dd-gone .cm-line': { backgroundColor: 'var(--diff-remove)' },
  '.cm-changedLineGutter, &.cm-merge-b .cm-changedLineGutter': { background: 'var(--success)' },
  '.cm-deletedLineGutter, &.cm-merge-a .cm-changedLineGutter': { background: 'var(--danger)' },
  '.dd-old-numbers .cm-gutterElement': {
    boxSizing: 'border-box',
    minWidth: '20px',
    padding: '0 3px 0 5px',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  '.cm-collapsedLines': {
    color: 'var(--muted)',
    background: 'var(--raise)',
    borderBlock: '1px solid var(--line)',
  },
});

export function baseExtensions(label: string): Extension[] {
  return [
    EditorState.readOnly.of(true),
    lineNumbers(),
    search({ top: true }),
    highlightSelectionMatches(),
    keymap.of(searchKeymap),
    syntaxHighlighting(highlightStyle),
    theme,
    EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': 'true' }),
  ];
}
