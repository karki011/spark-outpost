import { useEffect, useRef, useState, type RefObject } from 'react';
import { useFileDrop } from '../chat/attachments/use-file-drop.ts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { sortDrop, type DropKind } from './island-drop.ts';

export type GrabPhase =
  'idle' | 'enter' | 'over' | 'drop' | 'chew' | 'choose' | 'done' | 'leave' | 'reject';

export type FolderUse = 'project' | 'chat';
export type GrabOutcome = 'files' | FolderUse;

export interface GrabItem {
  kind: DropKind;
  name: string;
  preview: string | null;
  more: number;
}

export interface Grab {
  phase: GrabPhase;
  item: GrabItem | null;
  outcome: GrabOutcome | null;
  choose: (use: FolderUse) => void;
  cancel: () => void;
}

export const GRAB_MS = 520;
export const CHEW_MS = 760;
const DONE_MS = 900;
const LEAVE_MS = 650;
const REJECT_MS = 1_100;
const LEAN_REACH = 160;

interface DropOptions {
  islandRef: RefObject<HTMLElement | null>;
  sceneRef: RefObject<HTMLElement | null>;
  onStart: () => void;
  onAbort: () => void;
  onFiles: (files: File[]) => void;
  onFolders: (folders: string[], use: FolderUse) => Promise<void>;
  onDone: (outcome: GrabOutcome) => void;
  onNote: (note: string) => void;
}

function contains(rect: DOMRect | undefined, x: number, y: number): boolean {
  return (
    rect !== undefined && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  );
}

export function useIslandDrop(options: DropOptions) {
  const [phase, setPhase] = useState<GrabPhase>('idle');
  const [item, setItem] = useState<GrabItem | null>(null);
  const [outcome, setOutcome] = useState<GrabOutcome | null>(null);
  const folders = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (phase !== 'idle' || !item?.preview) return;
    URL.revokeObjectURL(item.preview);
  }, [phase, item]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const after = (ms: number, run: () => void) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(run, ms);
  };

  const rest = () => {
    folders.current = [];
    setPhase('idle');
    setItem(null);
    setOutcome(null);
  };

  const finish = (result: GrabOutcome) => {
    setOutcome(result);
    setPhase('done');
    after(DONE_MS, () => {
      rest();
      latest.current.onDone(result);
    });
  };

  const retreat = () => {
    folders.current = [];
    setPhase('leave');
    after(LEAVE_MS, rest);
    latest.current.onAbort();
  };

  const aim = (x: number, y: number) => {
    const scene = latest.current.sceneRef.current;
    if (scene) {
      const box = scene.getBoundingClientRect();
      const lean = Math.max(-1, Math.min(1, (x - (box.left + box.width / 2)) / LEAN_REACH));
      scene.style.setProperty('--lean', lean.toFixed(3));
      scene.style.setProperty('--from-x', `${Math.round(x - (box.left + box.width / 2))}px`);
      scene.style.setProperty('--from-y', `${Math.round(y - (box.top + box.height / 2))}px`);
    }
    const inside = contains(latest.current.islandRef.current?.getBoundingClientRect(), x, y);
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
          more: sorted.accepted - 1,
        },
      );
      const { onFiles, onNote } = latest.current;
      if (sorted.files.length > 0) onFiles(sorted.files);
      if (sorted.notes.length > 0) onNote(sorted.notes.join(' '));
      if (sorted.rejectedAll) {
        setPhase('reject');
        after(REJECT_MS, rest);
        return;
      }
      folders.current = sorted.folders;
      setPhase('drop');
      after(GRAB_MS, () => {
        setPhase('chew');
        after(CHEW_MS, () => {
          if (folders.current.length > 0) setPhase('choose');
          else finish('files');
        });
      });
    },
    {
      onEnter: () => {
        clearTimeout(timer.current);
        folders.current = [];
        setItem(null);
        setOutcome(null);
        setPhase('enter');
        latest.current.onStart();
      },
      onOver: aim,
      onLeave: retreat,
    },
  );

  const choosing = phase === 'choose';
  useEffect(() => {
    if (!choosing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      retreat();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  const grab: Grab = {
    phase,
    item,
    outcome,
    choose: (use) => {
      if (phase !== 'choose') return;
      const picked = folders.current;
      folders.current = [];
      setPhase('chew');
      latest.current.onFolders(picked, use).then(
        () => finish(use),
        (error: Error) => {
          latest.current.onNote(error.message);
          setPhase('reject');
          after(REJECT_MS, rest);
        },
      );
    },
    cancel: retreat,
  };
  return { grab, handlers: drop.handlers };
}
