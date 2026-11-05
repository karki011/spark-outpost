import './diff-frame.css';
import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEntry } from '@spark-outpost/contracts';
import { Skeleton } from '../ui/loading/Skeleton.tsx';

const DiffDrawer = lazy(() =>
  import('./drawer/DiffDrawer.tsx').then((module) => ({ default: module.DiffDrawer })),
);

export interface DiffRequest {
  taskId: string | null;
  target: ChangeEntry | null;
}

export interface DiffDrawerState {
  request: DiffRequest | null;
  open(taskId: string | null, target?: ChangeEntry): void;
  close(): void;
}

export function useDiffDrawer(): DiffDrawerState {
  const [request, setRequest] = useState<DiffRequest | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((taskId: string | null, target?: ChangeEntry) => {
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
        <Skeleton label="Opening the changes" shape="list" rows={8} />
        <Skeleton label="Opening the diff" shape="diff" rows={12} />
      </div>
    </aside>
  );
}

interface DiffDrawerHostProps {
  state: DiffDrawerState;
  taskId: string | null;
}

export function DiffDrawerHost({ state, taskId }: DiffDrawerHostProps) {
  const { request, close } = state;
  if (!request) return null;
  return createPortal(
    <Suspense fallback={<DrawerShell />}>
      <DiffDrawer taskId={request.taskId ?? taskId} target={request.target} onClose={close} />
    </Suspense>,
    document.body,
  );
}
