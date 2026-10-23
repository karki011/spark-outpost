import { memo, useMemo, type RefObject } from 'react';
import { lineSpans, scanLines, type Block } from './md-lines.ts';

interface MirrorLineProps {
  text: string;
  block: Block;
  mentionable: readonly string[] | undefined;
}

const MirrorLine = memo(function MirrorLine({ text, block, mentionable }: MirrorLineProps) {
  const spans = useMemo(() => lineSpans(text, block, mentionable), [text, block, mentionable]);
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
  mentionable?: readonly string[] | undefined;
}

export const MarkdownMirror = memo(function MarkdownMirror({
  text,
  mirrorRef,
  mentionable,
}: MarkdownMirrorProps) {
  const lines = useMemo(() => scanLines(text), [text]);
  return (
    <div ref={mirrorRef} className="mdf-mirror" aria-hidden="true">
      {lines.map((line, index) => (
        <MirrorLine key={index} text={line.text} block={line.block} mentionable={mentionable} />
      ))}
    </div>
  );
});
