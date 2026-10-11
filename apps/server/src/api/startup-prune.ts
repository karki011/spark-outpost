import { pruneUnlinkedAttachments } from '../persistence/attachments.ts';
import { pruneProtocolLog } from '../persistence/audit-log.ts';
import { pruneEmptyConversations } from '../persistence/conversations.ts';
import type { Db } from '../persistence/db.ts';
import { pruneSlackLog } from '../persistence/slack.ts';
import { pruneRemoteAudit } from '../remote/store.ts';

export interface StartupPrune {
  db: Db;
  workspaceId: string;
  auditRetentionDays: number;
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
  for (const [name, prune] of steps) {
    await prune().catch((error: unknown) => report(`Could not prune ${name} at startup`, error));
  }
}
