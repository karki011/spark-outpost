import { dialog } from 'electron';
import type { BrowserTabOwner } from '@spark-outpost/contracts';

export interface LeaveFacts {
  owner: BrowserTabOwner;
  shown: boolean;
  locked: boolean;
}

export function askToLeave(): boolean {
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Leave', 'Stay'],
    defaultId: 0,
    cancelId: 1,
    message: 'Leave this page?',
    detail: 'Changes you made may not be saved.',
  });
  return choice === 0;
}

export function leavesPage(facts: LeaveFacts, ask: () => boolean = askToLeave): boolean {
  if (facts.owner === 'agent') return true;
  if (facts.locked || !facts.shown) return false;
  return ask();
}
