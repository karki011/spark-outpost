import { pruneChatFolders } from '../chat-files/prune.ts';
import { pruneSparkFolders } from '../crew/prune.ts';
import { pruneUnlinkedAttachments } from '../persistence/attachments.ts';
import { pruneProtocolLog } from '../persistence/audit-log.ts';
import { pruneEmptyConversations } from '../persistence/conversations.ts';
import type { Db } from '../persistence/db.ts';
import { pruneSlackLog } from '../persistence/slack.ts';
import { pruneRemoteAudit } from '../remote/store.ts';

const PRUNE_EVERY_MS = 60 * 60 * 1000;

export interface StartupPrune {
  db: Db;
  workspaceId: string;
  auditRetentionDays: number;
  chatFolders?: string;
  researchCopies?: string;
  sparkFolders?: string;
  report?: (message: string, error: unknown) => void;
}

export async function pruneOldRows(options: StartupPrune): Promise<void> {
  const { db, workspaceId } = options;
  const report = options.report ?? ((message, error) => console.error(message, error));
  const steps: [string, () => Promise<unknown>][] = [
    ['empty chats', () => pruneEmptyConversations(db, workspaceId)],
    ['unlinked attachments', () => pruneUnlinkedAttachments(db, workspaceId)],
    ['old audit entries', () => pruneProtocolLog(db, options.auditRetentionDays)],
    ['old Slack log rows', () => pruneSlackLog(db, options.auditRetentionDays)],
    ['old remote control entries', () => pruneRemoteAudit(db, options.auditRetentionDays)],
  ];
  const { chatFolders, researchCopies } = options;
  if (chatFolders)
    steps.push(['folders of removed chats', () => pruneChatFolders(db, chatFolders)]);
  if (researchCopies) {
    steps.push(['research copies of removed chats', () => pruneChatFolders(db, researchCopies)]);
  }
  const { sparkFolders } = options;
  if (sparkFolders) {
    steps.push(['folders of removed Sparks', () => pruneSparkFolders(db, sparkFolders)]);
  }
  for (const [name, prune] of steps) {
    await prune().catch((error: unknown) => report(`Could not prune ${name}`, error));
  }
}

export interface PruneSchedule {
  stop(): void;
}

export function schedulePrune(
  options: StartupPrune,
  everyMs = PRUNE_EVERY_MS,
  prune: (options: StartupPrune) => Promise<void> = pruneOldRows,
): PruneSchedule {
  const report = options.report ?? ((message, error) => console.error(message, error));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await prune(options);
    } catch (error) {
      report('Could not prune old rows', error);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
