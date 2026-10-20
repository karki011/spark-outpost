import type { Panel } from './island-model.ts';

export const PANEL_ANNOUNCEMENTS: Record<Panel, string> = {
  home: 'Spark Island inbox open. Requests first, then running and finished chats.',
  quick: 'New chat composer open. Enter to send, Escape to close; your draft is kept.',
  ask: 'Ask Spark open.',
};
