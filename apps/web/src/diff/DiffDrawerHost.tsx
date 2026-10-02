import './diff-frame.css';
import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEntry } from '@spark-outpost/contracts';

const DiffDrawer = lazy(() =>
  import('./drawer/DiffDrawer.tsx').then((module) => ({ default: module.DiffDrawer })),
);

const SHELL_ROWS = ['72%', '54%', '80%', '46%', '66%', '58%'];

export interface DiffRequest {
  taskId: string;
  target: ChangeEntry | null;
}

export interface DiffDrawerState {
  request: DiffRequest | null;
  open(taskId: string, target?: ChangeEntry): void;
  close(): void;
}

export function useDiffDrawer(): DiffDrawerState {
  const [request, setRequest] = useState<DiffRequest | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((taskId: string, target?: ChangeEntry) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest('.dd')) opener.current = active;
    setRequest({ taskId, target: target ?? null });
  }, []);
  const close = useCallback(() => {
    setRequest(null);
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) requestAnimationFrame(() => back.focus());
  }, []);
  return { request, open, close };
}

function DrawerShell() {
  return (
    <aside className="dd" aria-label="Changes" aria-busy="true">
      <div className="dd-shell">
        <div className="dd-shell-col">
          {SHELL_ROWS.map((width) => (
            <span key={width} className="dd-skel" style={{ width }} />
          ))}
        </div>
        <div className="dd-shell-col">
          {SHELL_ROWS.map((width) => (
            <span key={width} className="dd-skel" style={{ width: `calc(${width} - 10%)` }} />
          ))}
        </div>
      </div>
    </aside>
  );
}

export function DiffDrawerHost({ state }: { state: DiffDrawerState }) {
  const { request, close } = state;
  if (!request) return null;
  return createPortal(
    <Suspense fallback={<DrawerShell />}>
      <DiffDrawer taskId={request.taskId} target={request.target} onClose={close} />
    </Suspense>,
    document.body,
  );
}
