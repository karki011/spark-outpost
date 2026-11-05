import {
  MergeView,
  getOriginalDoc,
  originalDocChangeEffect,
  unifiedMergeView,
} from '@codemirror/merge';
import { ChangeSet, Compartment, EditorState, Text, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseExtensions, languageLoader, loadedLanguage } from './code-setup.ts';
import { oldLineNumbers } from './old-line-numbers.ts';
import { changedRange } from './text-change.ts';
import { wordMarks } from './word-marks.ts';

export type DiffMode = 'unified' | 'split';

export interface CodeDiffInput {
  path: string;
  oldText: string | null;
  newText: string;
  change: 'added' | 'modified' | 'deleted';
  mode: DiffMode;
  wrap: boolean;
}

export interface CodeDiffView {
  setWrap(wrap: boolean): void;
  update(input: CodeDiffInput): boolean;
  destroy(): void;
}

function replaceDoc(view: EditorView, next: string): void {
  const change = changedRange(view.state.doc.toString(), next);
  if (change) view.dispatch({ changes: change });
}

function replaceOriginal(view: EditorView, current: string, next: string): void {
  const change = changedRange(current, next);
  if (!change) return;
  const changes = ChangeSet.of(change, current.length);
  view.dispatch({ effects: originalDocChangeEffect(view.state, changes) });
}

const COLLAPSE = { margin: 3, minSize: 4 };
const HIGHLIGHT_MAX_CHARS = 200 * 1024;
const DIFF_CONFIG = { scanLimit: 500, timeout: 30 };

function highlighted(input: CodeDiffInput): boolean {
  return (input.oldText?.length ?? 0) + input.newText.length <= HIGHLIGHT_MAX_CHARS;
}

function wrapping(wrap: boolean): Extension {
  return wrap ? EditorView.lineWrapping : [];
}

interface Slots {
  wrap: Compartment;
  language: Compartment;
}

function editorExtensions(slots: Slots, input: CodeDiffInput, label: string): Extension[] {
  return [
    baseExtensions(label),
    slots.wrap.of(wrapping(input.wrap)),
    slots.language.of((highlighted(input) && loadedLanguage(input.path)) || []),
  ];
}

function textOf(text: string): Text {
  return Text.of(text.split(/\r\n?|\n/));
}

function refreshRemovedLines(view: EditorView): void {
  const original = getOriginalDoc(view.state);
  const changes = ChangeSet.of({ from: 0, to: original.length, insert: original }, original.length);
  view.dispatch({ effects: originalDocChangeEffect(view.state, changes) });
}

function singleDoc(input: CodeDiffInput): string | null {
  if (input.change === 'added' || input.oldText === null) return input.newText;
  if (input.change === 'deleted') return input.oldText;
  return null;
}

interface Editor {
  view: EditorView;
  slots: Slots;
}

interface Mounted {
  editors: Editor[];
  root: { destroy(): void };
  layout: Layout;
}

type Layout = 'single' | 'split' | 'unified';

function layoutOf(input: CodeDiffInput): Layout {
  if (singleDoc(input) !== null) return 'single';
  return input.mode;
}

function newSlots(): Slots {
  return { wrap: new Compartment(), language: new Compartment() };
}

function mount(parent: HTMLElement, input: CodeDiffInput): Mounted {
  const single = singleDoc(input);
  const first = newSlots();
  if (single !== null) {
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: single,
        extensions: [
          editorExtensions(
            first,
            input,
            `${input.path}, ${input.change === 'deleted' ? 'deleted' : 'new'} file`,
          ),
          EditorView.editorAttributes.of({
            class: input.change === 'deleted' ? 'dd-gone' : 'dd-new',
          }),
        ],
      }),
    });
    return { editors: [{ view, slots: first }], root: view, layout: 'single' };
  }
  if (input.mode === 'split') {
    const second = newSlots();
    const docs = { before: textOf(input.oldText ?? ''), after: textOf(input.newText) };
    const merge = new MergeView({
      parent,
      a: {
        doc: docs.before,
        extensions: [editorExtensions(first, input, `${input.path} before`), wordMarks(docs)],
      },
      b: {
        doc: docs.after,
        extensions: [editorExtensions(second, input, `${input.path} after`), wordMarks(docs)],
      },
      highlightChanges: false,
      gutter: true,
      collapseUnchanged: COLLAPSE,
      diffConfig: DIFF_CONFIG,
    });
    return {
      editors: [
        { view: merge.a, slots: first },
        { view: merge.b, slots: second },
      ],
      root: merge,
      layout: 'split',
    };
  }
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: input.newText,
      extensions: [
        oldLineNumbers(),
        editorExtensions(first, input, `Changes to ${input.path}`),
        wordMarks(null),
        unifiedMergeView({
          original: input.oldText ?? '',
          mergeControls: false,
          highlightChanges: false,
          gutter: true,
          syntaxHighlightDeletions: true,
          collapseUnchanged: COLLAPSE,
          diffConfig: DIFF_CONFIG,
        }),
      ],
    }),
  });
  return { editors: [{ view, slots: first }], root: view, layout: 'unified' };
}

function applyTexts(mounted: Mounted, shown: CodeDiffInput, next: CodeDiffInput): void {
  const [first, second] = mounted.editors;
  if (!first) return;
  if (mounted.layout === 'single') {
    replaceDoc(first.view, singleDoc(next) ?? '');
  } else if (mounted.layout === 'split' && second) {
    replaceDoc(first.view, next.oldText ?? '');
    replaceDoc(second.view, next.newText);
  } else {
    replaceOriginal(first.view, shown.oldText ?? '', next.oldText ?? '');
    replaceDoc(first.view, next.newText);
  }
}

export function createCodeDiff(parent: HTMLElement, input: CodeDiffInput): CodeDiffView {
  const mounted = mount(parent, input);
  const { editors, root } = mounted;
  let shown = input;
  let alive = true;
  const reconfigure = (pick: (slots: Slots) => Compartment, extension: Extension) => {
    for (const { view, slots } of editors) {
      view.dispatch({ effects: pick(slots).reconfigure(extension) });
    }
  };
  const loader =
    highlighted(input) && !loadedLanguage(input.path) ? languageLoader(input.path) : null;
  if (loader) {
    void loader().then((language) => {
      if (!alive) return;
      reconfigure((slots) => slots.language, language);
      if (mounted.layout === 'unified') refreshRemovedLines(editors[0]!.view);
    });
  }
  return {
    setWrap: (wrap) => reconfigure((slots) => slots.wrap, wrapping(wrap)),
    update: (next) => {
      if (next.path !== shown.path || layoutOf(next) !== mounted.layout) return false;
      applyTexts(mounted, shown, next);
      shown = next;
      return true;
    },
    destroy: () => {
      alive = false;
      root.destroy();
    },
  };
}
