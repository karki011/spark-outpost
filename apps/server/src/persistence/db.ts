import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool, 'query'>;

export function createDb(connectionString: string, searchPath?: string): Db {
  const options = searchPath ? `-c search_path=${searchPath}` : undefined;
  return new pg.Pool({ connectionString, max: 10, ...(options ? { options } : {}) });
}

export async function withTransaction<T>(
  db: Db,
  work: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
