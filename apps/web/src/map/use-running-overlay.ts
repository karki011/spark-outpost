import { useMemo, useState } from 'react';
import type { Highlights } from './map-model.ts';
import {
  NO_MARKS,
  runningMarks,
  wantedPaths,
  type RunningChat,
  type RunningMarks,
} from './running-model.ts';
import type { Scene } from './scene.ts';
import { useLocate } from './use-locate.ts';
import { useRunningChats } from './use-running-chats.ts';

export interface RunningOverlay {
  on: boolean;
  setOn: (on: boolean) => void;
  chats: RunningChat[];
  count: number;
  focused: string | null;
  setFocused: (id: string | null) => void;
  marks: RunningMarks;
  lit: Highlights;
}

export function useRunningOverlay(
  scene: Scene,
  projectIds: readonly string[],
  base: Highlights,
  require: (keys: readonly string[]) => void,
): RunningOverlay {
  const [on, setOn] = useState(false);
  const [focus, setFocused] = useState<string | null>(null);
  const running = useRunningChats(projectIds, on);
  const focused = running.chats.some((chat) => chat.id === focus) ? focus : null;
  const marks = useMemo(
    () => (on ? runningMarks(scene, running.chats, focused) : NO_MARKS),
    [on, scene, running.chats, focused],
  );
  const wanted = useMemo(
    () => (on ? wantedPaths(running.chats, focused) : null),
    [on, running.chats, focused],
  );
  useLocate(scene, wanted, require);
  const lit = useMemo(
    () =>
      marks.changed.size === 0
        ? base
        : { changed: new Set([...base.changed, ...marks.changed]), dependents: base.dependents },
    [base, marks.changed],
  );
  return {
    on,
    setOn: (next) => {
      setOn(next);
      setFocused(null);
    },
    chats: running.chats,
    count: running.count,
    focused,
    setFocused,
    marks,
    lit,
  };
}
