import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool, 'query'>;

export const POOL_MAX = { api: 8, worker: 8, test: 4, script: 4 } as const;

export interface DbOptions {
  max?: number;
  searchPath?: string;
  connectTries?: number;
  retryBaseMs?: number;
}

const TRANSIENT_CODES = new Set([
  '53300',
  '57P03',
  '08000',
  '08001',
  '08004',
  '08006',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
]);

export function isTransientConnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
  return /timeout exceeded when trying to connect|Connection terminated/i.test(error.message);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ConnectCallback = (
  error: Error | undefined,
  client: pg.PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

class RetryingPool extends pg.Pool {
  readonly #tries: number;
  readonly #baseMs: number;

  constructor(config: pg.PoolConfig, tries: number, baseMs: number) {
    super(config);
    this.#tries = tries;
    this.#baseMs = baseMs;
  }

  async #connectWithRetry(): Promise<pg.PoolClient> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await super.connect();
      } catch (error) {
        if (attempt >= this.#tries || this.ending || !isTransientConnectError(error)) throw error;
        console.warn(`Database connection failed (${String(error)}); retry ${attempt}.`);
        await pause(this.#baseMs * 2 ** (attempt - 1));
      }
    }
  }

  override connect(): Promise<pg.PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    const connecting = this.#connectWithRetry();
    if (!callback) return connecting;
    connecting.then(
      (client) => callback(undefined, client, (release) => client.release(release as Error)),
      (error: Error) => callback(error, undefined, () => undefined),
    );
  }
}

export function createDb(connectionString: string, options: DbOptions = {}): Db {
  const { searchPath, max = POOL_MAX.script, connectTries = 5, retryBaseMs = 200 } = options;
  return new RetryingPool(
    {
      connectionString,
      max,
      ...(searchPath ? { options: `-c search_path=${searchPath}` } : {}),
    },
    connectTries,
    retryBaseMs,
  );
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
