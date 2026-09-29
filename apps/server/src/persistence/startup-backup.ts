import { backupDatabase } from './backup.ts';

interface BackupConfig {
  DATABASE_URL: string;
  BACKUP_DIR?: string | undefined;
}

export function configuredBackup(config: BackupConfig): (() => Promise<string>) | undefined {
  const dir = config.BACKUP_DIR;
  if (!dir) return undefined;
  return () => backupDatabase({ databaseUrl: config.DATABASE_URL, dir });
}
