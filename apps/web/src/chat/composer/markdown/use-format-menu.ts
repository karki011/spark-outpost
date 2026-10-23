import type { RefObject } from 'react';
import { useMenuCommand } from '../../../desktop/use-menu-command.ts';
import type { ToolAction } from './format-tools.tsx';

const MENU_ACTIONS: Record<string, ToolAction> = {
  'format:bold': 'bold',
  'format:italic': 'italic',
  'format:strike': 'strike',
  'format:code': 'code',
  'format:link': 'link',
};

export function useFormatMenu(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  run: (action: ToolAction) => void,
): void {
  useMenuCommand((command) => {
    const action = MENU_ACTIONS[command];
    if (action && textareaRef.current && document.activeElement === textareaRef.current) {
      run(action);
    }
  });
}
