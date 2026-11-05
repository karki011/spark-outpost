import type { BrowserPick, BrowserSelectedText } from '@spark-outpost/contracts';
import { blockquote } from '../chat/quotes/quote-text.ts';
import {
  TERMINAL_NO_INPUT,
  TERMINAL_NOT_RUNNING,
  type TerminalDraftTarget,
} from '../terminal/draft-target.ts';
import { pickFiles, pickText, selectedTextFiles, selectedTextNote } from './pick-files.ts';
import { pickDraft, selectedTextDraft } from './terminal-drafts.ts';

export interface BrowserInputDeps {
  terminal: boolean;
  addPick(text: string, files: File[]): void;
  focusComposer(): void;
  terminalTarget(): TerminalDraftTarget | null;
  savePicture(pick: BrowserPick): Promise<string | null>;
  notice(message: string | null): void;
}

function refusal(deps: BrowserInputDeps): string | null {
  const target = deps.terminalTarget();
  return target ? target.refusal() : TERMINAL_NOT_RUNNING;
}

function intoTerminal(deps: BrowserInputDeps, kind: 'add' | 'ask', draft: string): void {
  const refused = refusal(deps);
  if (refused) {
    deps.notice(refused);
    return;
  }
  const inserted = deps.terminalTarget()?.insert(kind, draft) ?? false;
  deps.notice(inserted ? null : TERMINAL_NO_INPUT);
}

export async function routePick(pick: BrowserPick, deps: BrowserInputDeps): Promise<void> {
  if (!deps.terminal) {
    deps.addPick(pickText(pick), pickFiles(pick));
    return;
  }
  const refused = refusal(deps);
  if (refused) {
    deps.notice(refused);
    return;
  }
  const picture = pick.image ? await deps.savePicture(pick).catch(() => null) : null;
  intoTerminal(deps, 'ask', pickDraft(pick, picture));
}

export function routeSelectedText(selected: BrowserSelectedText, deps: BrowserInputDeps): void {
  if (!deps.terminal) {
    deps.addPick(selectedTextNote(selected), selectedTextFiles(selected));
    if (selected.intent === 'ask') deps.focusComposer();
    return;
  }
  const draft = selectedTextDraft(selected);
  if (selected.intent === 'ask') intoTerminal(deps, 'ask', draft);
  else intoTerminal(deps, 'add', blockquote(draft));
}
