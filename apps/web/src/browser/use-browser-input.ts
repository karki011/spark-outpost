import { useEffect } from 'react';
import type { BrowserPick } from '@spark-outpost/contracts';
import { uploadAttachment } from '../api/attachments.ts';
import { draftTarget } from '../terminal/draft-target.ts';
import { nativeTerminalApi } from '../terminal/terminal-api.ts';
import { routePick, routeSelectedText, type BrowserInputDeps } from './browser-input.ts';
import { onBrowserPick, onBrowserText, setPaneNotice } from './browser-store.ts';
import { pickFiles } from './pick-files.ts';

async function savePicture(chatId: string, pick: BrowserPick): Promise<string | null> {
  const picture = pickFiles(pick)[1];
  if (!picture) return null;
  const uploaded = await uploadAttachment(picture, { mediaType: picture.type });
  return (await nativeTerminalApi.saveImage(chatId, uploaded.id)).path;
}

export function useBrowserInput(
  chatId: string,
  terminal: boolean,
  addPick: (text: string, files: File[]) => void,
  focusComposer: () => void,
): void {
  useEffect(() => {
    const deps: BrowserInputDeps = {
      terminal,
      addPick,
      focusComposer,
      terminalTarget: () => draftTarget(chatId),
      savePicture: (pick) => savePicture(chatId, pick),
      notice: (message) => setPaneNotice(chatId, message),
    };
    const stopPicks = onBrowserPick((pick) => {
      if (pick.chatId === chatId) void routePick(pick, deps);
    });
    const stopText = onBrowserText((selected) => {
      if (selected.chatId === chatId) routeSelectedText(selected, deps);
    });
    return () => {
      stopPicks();
      stopText();
    };
  }, [chatId, terminal, addPick, focusComposer]);
}
