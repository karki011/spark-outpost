import './markdown-input.css';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  type TextareaHTMLAttributes,
} from 'react';
import { MAC } from '../../../ui/shortcuts.ts';
import { applyEdit } from './apply-edit.ts';
import { FormatBar, SelectionToolbar } from './FormatBar.tsx';
import type { ToolAction } from './format-tools.tsx';
import { LinkEditor } from './LinkEditor.tsx';
import { MarkdownMirror } from './MarkdownMirror.tsx';
import {
  linkEdit,
  linkTarget,
  toggleCodeBlock,
  toggleLinePrefix,
  unlinkEdit,
  type LinkTarget,
} from './md-block-format.ts';
import { toggleInline, type Edit } from './md-format.ts';
import { formatShortcut } from './md-keys.ts';
import { marksAt } from './md-lines.ts';
import { pasteMarkdown } from './md-paste.ts';
import { anchorPoint, copyTextareaStyles } from './mirror-geometry.ts';
import { useFormatMenu } from './use-format-menu.ts';

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'children'>;

interface MarkdownInputProps extends TextareaProps {
  ref: RefObject<HTMLTextAreaElement | null>;
  value: string;
  formatting: boolean;
}

interface Selection {
  start: number;
  end: number;
}

interface OpenLink {
  target: LinkTarget;
  position: CSSProperties;
}

const FLOAT_GAP = 6;
const LINK_WIDTH = 300;

function editFor(
  action: Exclude<ToolAction, 'link'>,
  text: string,
  { start, end }: Selection,
): Edit {
  if (action === 'bullet' || action === 'numbered' || action === 'quote') {
    return toggleLinePrefix(text, start, end, action);
  }
  if (action === 'codeblock') return toggleCodeBlock(text, start, end);
  return toggleInline(text, start, end, action);
}

function selectionOf(textarea: HTMLTextAreaElement): Selection {
  return { start: textarea.selectionStart, end: textarea.selectionEnd };
}

export function MarkdownInput({
  ref,
  value,
  formatting,
  id,
  onKeyDown,
  onPaste,
  onSelect,
  onFocus,
  onBlur,
  onScroll,
  ...textareaProps
}: MarkdownInputProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const boxRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const floatRef = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<OpenLink | null>(null);
  const caret = selection.end > selection.start ? selection.start + 1 : selection.start;
  const active = useMemo(() => marksAt(value, caret), [value, caret]);
  const showFloat = focused && !formatting && link === null && selection.end > selection.start;

  useLayoutEffect(() => {
    const textarea = ref.current;
    const mirror = mirrorRef.current;
    if (!textarea || !mirror) return;
    copyTextareaStyles(textarea, mirror);
    const observer = new ResizeObserver(() => copyTextareaStyles(textarea, mirror));
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [ref]);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (textarea && mirrorRef.current) mirrorRef.current.scrollTop = textarea.scrollTop;
  });

  const anchor = (offset: number) => {
    const box = boxRef.current;
    const mirror = mirrorRef.current;
    return box && mirror ? anchorPoint(box, mirror, value, offset, FLOAT_GAP) : null;
  };

  useLayoutEffect(() => {
    const toolbar = floatRef.current;
    const box = boxRef.current;
    const mirror = mirrorRef.current;
    if (!showFloat || !toolbar || !box || !mirror) return;
    const point = anchorPoint(box, mirror, value, selection.start, FLOAT_GAP);
    const room = Math.max(0, (point?.width ?? 0) - toolbar.offsetWidth);
    toolbar.style.left = `${Math.min(room, Math.max(0, (point?.left ?? 0) - 8))}px`;
    toolbar.style.bottom = point ? `${point.bottom}px` : '100%';
  }, [showFloat, selection.start, value]);

  const track = (textarea: HTMLTextAreaElement) => {
    const next = selectionOf(textarea);
    setSelection((now) => (now.start === next.start && now.end === next.end ? now : next));
  };

  const openLink = () => {
    const textarea = ref.current;
    if (!textarea) return;
    const { start, end } = selectionOf(textarea);
    const point = anchor(start);
    const left = point
      ? Math.min(Math.max(0, point.left), Math.max(0, point.width - LINK_WIDTH))
      : 0;
    setLink({
      target: linkTarget(textarea.value, start, end),
      position: { left, bottom: point?.bottom ?? '100%' },
    });
  };

  const run = (action: ToolAction) => {
    const textarea = ref.current;
    if (!textarea) return;
    if (action === 'link') openLink();
    else applyEdit(textarea, editFor(action, textarea.value, selectionOf(textarea)));
  };

  useFormatMenu(ref, run);

  const finishLink = (edit: Edit | null) => {
    setLink(null);
    const textarea = ref.current;
    if (!textarea) return;
    if (edit) applyEdit(textarea, edit);
    else textarea.focus({ preventScroll: true });
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = event.nativeEvent.isComposing ? null : formatShortcut(event, MAC);
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      run(action);
      return;
    }
    onKeyDown?.(event);
  };

  return (
    <div ref={boxRef} className="mdf">
      {formatting && (
        <FormatBar
          controls={inputId}
          active={active}
          onAction={run}
          onLeave={() => ref.current?.focus()}
        />
      )}
      <div className="mdf-field">
        <MarkdownMirror text={value} mirrorRef={mirrorRef} />
        <textarea
          {...textareaProps}
          ref={ref}
          id={inputId}
          value={value}
          onKeyDown={keyDown}
          onPaste={(event) => {
            onPaste?.(event);
            pasteMarkdown(event);
          }}
          onSelect={(event) => {
            track(event.currentTarget);
            onSelect?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            track(event.currentTarget);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onScroll={(event) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
            onScroll?.(event);
          }}
        />
      </div>
      {showFloat && <SelectionToolbar toolbarRef={floatRef} active={active} onAction={run} />}
      {link && (
        <LinkEditor
          target={link.target}
          position={link.position}
          onSave={(label, url) => finishLink(linkEdit(link.target, label, url))}
          onRemove={() => finishLink(unlinkEdit(link.target))}
          onClose={() => finishLink(null)}
        />
      )}
    </div>
  );
}
