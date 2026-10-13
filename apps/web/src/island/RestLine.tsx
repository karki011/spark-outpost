import type { CSSProperties } from 'react';
import { restLineTitle, type RestLine as RestLineData } from './island-rest-line.ts';

export function scoutLabel(asking: number, setAside: number): string {
  const parts = [
    asking > 0 ? `${asking} need you` : null,
    setAside > 0 ? `${setAside} set aside` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? `Spark: ${parts.join(', ')}. Open Spark Island` : 'Open Spark Island';
}

export function ScoutMarks({ asking, setAside }: { asking: number; setAside: number }) {
  return (
    <>
      {asking > 0 && (
        <span className="isl-pbadge" aria-hidden="true">
          {asking}
        </span>
      )}
      {setAside > 0 && (
        <span className="isl-aside" aria-hidden="true">
          {setAside}
        </span>
      )}
    </>
  );
}

interface RestLineProps {
  line: RestLineData;
  top: number;
  onOpen: (line: RestLineData) => void;
}

export function RestLine({ line, top, onOpen }: RestLineProps) {
  return (
    <button
      type="button"
      className="isl-restline"
      data-kind={line.kind}
      title={restLineTitle(line)}
      style={{ '--line-top': `${top}px` } as CSSProperties}
      onClick={() => onOpen(line)}
    >
      <span className="isl-restline-dot" aria-hidden="true" />
      <span className="isl-restline-text">{line.text}</span>
      {line.kind === 'waiting' && (
        <>
          <span aria-hidden="true">·</span>
          <b>Review</b>
        </>
      )}
      {line.more > 0 && <span className="isl-restline-more">+{line.more} more</span>}
    </button>
  );
}
