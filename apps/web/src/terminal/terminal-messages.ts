import type { TerminalEndReason } from '@spark-outpost/contracts';

export const endMessages: Record<TerminalEndReason, string> = {
  exited: 'The shell exited.',
  closed: 'Terminal closed.',
  disconnected: 'Terminal closed.',
  idle: 'Closed after 10 minutes without input.',
  time_limit: 'Closed after 30 minutes.',
  shutdown: 'Closed because Spark Outpost stopped.',
  folder_removed: 'This folder was removed, so its terminal closed.',
  chat_removed: 'This chat was deleted, so its terminal closed.',
};
