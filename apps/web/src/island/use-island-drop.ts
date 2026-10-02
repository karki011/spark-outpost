import { useEffect, useRef, useState, type RefObject } from 'react';
import { useFileDrop } from '../chat/attachments/use-file-drop.ts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { sortDrop, type DropKind } from './island-drop.ts';
import { Spring } from './springs.ts';

export type GrabPhase = 'idle' | 'enter' | 'over' | 'drop' | 'leave' | 'reject';

export interface GrabItem {
  kind: DropKind;
  name: string;
  preview: string | null;
}

export const GRAB_MS = 850;
const LEAVE_MS = 650;
const REACH: Record<GrabPhase, number> = {
  idle: 0,
  enter: 0.35,
  over: 1,
  drop: 0,
  leave: 0,
  reject: 0,
};

interface DropOptions {
  islandRef: RefObject<HTMLElement | null>;
  sceneRef: RefObject<HTMLElement | null>;
  reduced: boolean;
  onStart: () => void;
  onAbort: () => void;
  onFiles: (files: File[]) => void;
  onFolder: (folder: string) => void;
  onNote: (note: string) => void;
}

function useReach(sceneRef: RefObject<HTMLElement | null>, target: number, reduced: boolean) {
  const spring = useRef(new Spring(0));
  useEffect(() => {
    const value = spring.current;
    const write = () => sceneRef.current?.style.setProperty('--reach', value.value.toFixed(3));
    if (reduced) {
      value.jump(target);
      write();
      return;
    }
    value.springTo(target, 0.42, 0.45);
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      value.step(Math.min(0.05, (now - last) / 1000), now);
      last = now;
      write();
      if (value.busy) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [sceneRef, target, reduced]);
}

export function useIslandDrop(options: DropOptions) {
  const [phase, setPhase] = useState<GrabPhase>('idle');
  const [item, setItem] = useState<GrabItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  useReach(options.sceneRef, REACH[phase], options.reduced);

  useEffect(() => {
    if (phase !== 'idle' || !item?.preview) return;
    URL.revokeObjectURL(item.preview);
  }, [phase, item]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next: GrabPhase, ms: number) => {
    clearTimeout(timer.current);
    setPhase(next);
    timer.current = setTimeout(() => {
      setPhase('idle');
      setItem(null);
    }, ms);
  };

  const aim = (x: number, y: number) => {
    const scene = latest.current.sceneRef.current;
    const island = latest.current.islandRef.current?.getBoundingClientRect();
    if (scene) {
      const box = scene.getBoundingClientRect();
      const lean = Math.max(-1, Math.min(1, (x - (box.left + box.width / 2)) / 160));
      scene.style.setProperty('--lean', lean.toFixed(3));
      scene.style.setProperty('--drop-x', `${x - box.left}px`);
      scene.style.setProperty('--drop-y', `${y - box.top}px`);
    }
    const inside =
      island !== undefined &&
      x >= island.left &&
      x <= island.right &&
      y >= island.top &&
      y <= island.bottom;
    setPhase((current) =>
      current === 'enter' || current === 'over' ? (inside ? 'over' : 'enter') : current,
    );
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
  };

  const drop = useFileDrop(
    (files, transfer) => {
      const desktop = sparkDesktop();
      const sorted = sortDrop(files, transfer, (file) => desktop?.island.pathForFile(file) ?? null);
      const shown = sorted.shown;
      setItem(
        shown && {
          kind: shown.kind,
          name: shown.name,
          preview: shown.kind === 'image' ? URL.createObjectURL(shown.file) : null,
        },
      );
      const { onFiles, onFolder, onNote } = latest.current;
      if (sorted.files.length > 0) onFiles(sorted.files);
      sorted.folders.forEach(onFolder);
      if (sorted.notes.length > 0) onNote(sorted.notes.join(' '));
      settle(sorted.rejectedAll ? 'reject' : 'drop', GRAB_MS);
    },
    {
      onEnter: () => {
        clearTimeout(timer.current);
        setItem(null);
        setPhase('enter');
        latest.current.onStart();
      },
      onOver: aim,
      onLeave: () => {
        settle('leave', LEAVE_MS);
        latest.current.onAbort();
      },
    },
  );

  return { phase, item, handlers: drop.handlers };
}
