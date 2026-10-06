import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { plainOutput } from '@spark-outpost/contracts';
import { mountOutputView, type OutputView } from '../../terminal/output-view.ts';

const NEAR_VIEWPORT = '300px';
const READER_CHARS = 4_000;
const TOP = -1_000_000;

interface CommandScreenProps {
  text: string;
  appended: number;
  epoch: number;
  tall: boolean;
  onTouched: () => void;
}

function useNearViewport(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: NEAR_VIEWPORT },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, near];
}

function scrollKey(view: OutputView, key: string): boolean {
  if (key === 'ArrowUp') view.scrollLines(-1);
  else if (key === 'ArrowDown') view.scrollLines(1);
  else if (key === 'PageUp') view.scrollPages(-1);
  else if (key === 'PageDown') view.scrollPages(1);
  else if (key === 'Home') view.scrollLines(TOP);
  else if (key === 'End') view.scrollToEnd();
  else return false;
  return true;
}

export function readerText(text: string): string {
  return plainOutput(text.slice(-READER_CHARS * 2)).slice(-READER_CHARS);
}

export function CommandScreen({ text, appended, epoch, tall, onTouched }: CommandScreenProps) {
  const [frame, near] = useNearViewport();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<OutputView | null>(null);
  const written = useRef({ appended: 0, epoch: -1 });
  const [plain, setPlain] = useState(false);

  useEffect(() => {
    if (!near || plain || !host.current) return;
    const opened = mountOutputView(host.current, () => setPlain(true));
    view.current = opened;
    written.current = { appended: 0, epoch: -1 };
    return () => {
      view.current = null;
      opened.dispose();
    };
  }, [near, plain]);

  useEffect(() => {
    const opened = view.current;
    if (!opened) return;
    const added = appended - written.current.appended;
    const fresh = written.current.epoch !== epoch || added < 0 || added > text.length;
    if (fresh) opened.replace(text);
    else if (added > 0) opened.write(text.slice(text.length - added));
    written.current = { appended, epoch };
  }, [text, appended, epoch, near, plain]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!view.current || !scrollKey(view.current, event.key)) return;
    event.preventDefault();
    onTouched();
  };

  return (
    <div
      ref={frame}
      className={tall ? 'run-cmd-screen tall' : 'run-cmd-screen'}
      role="group"
      aria-label="Command output"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onWheel={onTouched}
      onPointerDown={onTouched}
    >
      {plain ? (
        <pre className="run-cmd-plain">{plainOutput(text)}</pre>
      ) : (
        <>
          <div className="run-cmd-xterm" ref={host} aria-hidden="true" />
          <pre className="sr-only">{readerText(text)}</pre>
        </>
      )}
    </div>
  );
}
