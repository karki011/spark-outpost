import type { Panel } from './island-model.ts';

export const PANEL_ANNOUNCEMENTS: Record<Panel, string> = {
  home: 'Spark Island open. Home shows what is happening now.',
  quick: 'New chat composer open. Enter to send, Escape to close; your draft is kept.',
  sessions: 'Chats open. Type to search, arrows to move, Enter to open.',
  ask: 'Ask Spark open.',
};
