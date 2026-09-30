import { use, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownIcon } from '../../ui/icons.tsx';
import { DockContext } from './dock-context.ts';

interface DockedProps {
  id: string;
  order: string;
  label: string;
  pending: boolean;
  children: ReactNode;
}

export function Docked({ id, order, label, pending, children }: DockedProps) {
  const dock = use(DockContext);
  const docking = pending && dock !== null;
  const register = dock?.register;
  const unregister = dock?.unregister;

  useEffect(() => {
    if (!docking || !register || !unregister) return;
    register({ id, order, label });
    return () => unregister(id);
  }, [docking, register, unregister, id, order, label]);

  if (!docking) return children;
  const slot = dock.slots.get(id);
  return (
    <>
      <p className="dock-stub">
        <span className="dock-stub-what">{label}</span>
        <button type="button" className="dock-stub-go" onClick={() => dock.jump(id)}>
          Waiting for your answer
          <ArrowDownIcon />
        </button>
      </p>
      {slot && createPortal(children, slot)}
    </>
  );
}
