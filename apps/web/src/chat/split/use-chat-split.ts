import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { TABLET_QUERY, useMediaQuery } from '../../ui/breakpoints.ts';
import {
  closePane,
  focusPane,
  leaveChat,
  openBeside,
  readSavedSplit,
  restoredSplit,
  saveSplit,
  showChat,
  type ChatSplit,
  type PaneSide,
} from './chat-split.ts';

export interface ChatSplitControl {
  primary: string | null;
  secondary: string | null;
  focus: PaneSide;
  ratio: number;
  canSplit: boolean;
  show(id: string): void;
  openBeside(id: string, current: string | null): void;
  close(side: PaneSide): void;
  focusPane(side: PaneSide): void;
  setRatio(ratio: number): void;
  leave(id: string): boolean;
}

export function useChatSplit(chats: readonly ConversationSummary[] | undefined): ChatSplitControl {
  const [split, setSplit] = useState<ChatSplit>(readSavedSplit);
  const latest = useRef(split);
  useEffect(() => {
    latest.current = split;
  }, [split]);
  const narrow = useMediaQuery(TABLET_QUERY);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current || !chats) return;
    restored.current = true;
    setSplit((current) => restoredSplit(current, chats));
  }, [chats]);

  useEffect(() => saveSplit(split), [split]);

  const show = useCallback((id: string) => setSplit((s) => showChat(s, id, narrow)), [narrow]);
  const beside = useCallback(
    (id: string, current: string | null) => {
      if (!narrow) setSplit((s) => openBeside(s, id, current));
    },
    [narrow],
  );
  const close = useCallback((side: PaneSide) => setSplit((s) => closePane(s, side)), []);
  const focus = useCallback((side: PaneSide) => setSplit((s) => focusPane(s, side)), []);
  const setRatio = useCallback((ratio: number) => setSplit((s) => ({ ...s, ratio })), []);
  const leave = useCallback((id: string) => {
    const next = leaveChat(latest.current, id);
    if (next) setSplit(next);
    return next !== null;
  }, []);

  const secondary = narrow ? null : split.secondary;
  return useMemo(
    () => ({
      primary: split.primary,
      secondary,
      focus: secondary === null ? 'primary' : split.focus,
      ratio: split.ratio,
      canSplit: !narrow,
      show,
      openBeside: beside,
      close,
      focusPane: focus,
      setRatio,
      leave,
    }),
    [split, secondary, narrow, show, beside, close, focus, setRatio, leave],
  );
}
