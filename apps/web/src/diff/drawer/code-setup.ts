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

export function languageLoader(path: string): Loader | null {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? null;
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

const ADD = 'color-mix(in srgb, var(--success) 12%, transparent)';
const ADD_TEXT = 'color-mix(in srgb, var(--success) 24%, transparent)';
const REMOVE = 'color-mix(in srgb, var(--danger) 11%, transparent)';
const REMOVE_TEXT = 'color-mix(in srgb, var(--danger) 20%, transparent)';

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
  '.cm-changedLine, .cm-insertedLine, &.cm-merge-b .cm-changedLine': { backgroundColor: ADD },
  '.cm-changedText, &.cm-merge-b .cm-changedText': { background: ADD_TEXT },
  '.cm-deletedChunk, .cm-deletedLine, &.cm-merge-a .cm-changedLine': { backgroundColor: REMOVE },
  '.cm-deletedChunk .cm-deletedText, &.cm-merge-a .cm-changedText, .cm-deletedLine del': {
    background: REMOVE_TEXT,
    textDecoration: 'none',
  },
  '.cm-changedLineGutter, &.cm-merge-b .cm-changedLineGutter': { background: 'var(--success)' },
  '.cm-deletedLineGutter, &.cm-merge-a .cm-changedLineGutter': { background: 'var(--danger)' },
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
