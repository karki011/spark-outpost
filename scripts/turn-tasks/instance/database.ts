import { createDb, type Db } from '../../../apps/server/src/persistence/db.ts';
import { testDatabaseUrl } from '../../test-database.ts';

export interface ThrowawaySchema {
  name: string;
  url: string;
  db: Db;
  drop(): Promise<void>;
}

async function admin(url: string, sql: string): Promise<void> {
  const db = createDb(url);
  try {
    await db.query(sql);
  } finally {
    await db.end();
  }
}

export function schemaName(now: number = Date.now()): string {
  return `turn_tasks_${now}`;
}

export function schemaUrl(testUrl: string, name: string): string {
  const url = new URL(testUrl);
  url.searchParams.set('options', `-c search_path=${name}`);
  return url.toString();
}

export async function createThrowawaySchema(name: string = schemaName()): Promise<ThrowawaySchema> {
  const testUrl = testDatabaseUrl();
  await admin(testUrl, `CREATE SCHEMA ${name}`);
  const db = createDb(testUrl, { searchPath: name });
  return {
    name,
    url: schemaUrl(testUrl, name),
    db,
    async drop() {
      await db.end();
      await admin(testUrl, `DROP SCHEMA ${name} CASCADE`);
    },
  };
}
