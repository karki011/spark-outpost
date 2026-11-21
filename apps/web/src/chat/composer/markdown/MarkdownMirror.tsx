import { memo, useMemo, type RefObject } from 'react';
import { lineSpans, scanLines, type Block } from './md-lines.ts';

interface MirrorLineProps {
  text: string;
  block: Block;
}

const MirrorLine = memo(function MirrorLine({ text, block }: MirrorLineProps) {
  const spans = useMemo(() => lineSpans(text, block), [text, block]);
  return (
    <div className={`mdl mdl-${block}`}>
      {spans.length === 0 ? (
        <br />
      ) : (
        spans.map((span, index) =>
          span.marks.length === 0 ? (
            span.text
          ) : (
            <span key={index} className={span.marks.map((mark) => `mdm-${mark}`).join(' ')}>
              {span.text}
            </span>
          ),
        )
      )}
    </div>
  );
});

interface MarkdownMirrorProps {
  text: string;
  mirrorRef: RefObject<HTMLDivElement | null>;
}

export const MarkdownMirror = memo(function MarkdownMirror({
  text,
  mirrorRef,
}: MarkdownMirrorProps) {
  const lines = useMemo(() => scanLines(text), [text]);
  return (
    <div ref={mirrorRef} className="mdf-mirror" aria-hidden="true">
      {lines.map((line, index) => (
        <MirrorLine key={index} text={line.text} block={line.block} />
      ))}
    </div>
  );
});
