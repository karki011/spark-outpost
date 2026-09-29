import { backupDatabase } from './backup.ts';

interface BackupConfig {
  DATABASE_URL: string;
  BACKUP_DIR?: string | undefined;
}

export function isTestDatabase(databaseUrl: string): boolean {
  return /_test(_\w+)?$/.test(new URL(databaseUrl).pathname);
}

export function configuredBackup(config: BackupConfig): (() => Promise<string>) | undefined {
  const dir = config.BACKUP_DIR;
  if (!dir || isTestDatabase(config.DATABASE_URL)) return undefined;
  return () => backupDatabase({ databaseUrl: config.DATABASE_URL, dir });
}
