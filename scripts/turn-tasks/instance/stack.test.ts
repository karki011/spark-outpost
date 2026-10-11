import { describe, expect, it } from 'vitest';
import { schemaName, schemaUrl } from './database.ts';
import { DEFAULT_PORT_SLOT, DRY_RUN_KEY, portSlot, stackEnv } from './stack.ts';

const DATABASE = 'postgres://u:p@127.0.0.1:5544/spark_outpost_test?options=-c%20search_path%3Dx';
const BASE = {
  PATH: '/usr/bin',
  TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1:5544/spark_outpost_test',
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5544/spark_outpost',
  BACKUP_DIR: '/backups',
  SECRET_STORE: 'keychain',
};

describe('the isolated instance', () => {
  it('uses port slot 17 unless another slot is named', () => {
    expect(DEFAULT_PORT_SLOT).toBe(17);
    expect(portSlot({})).toBe(17);
    expect(portSlot({ SPARK_TEST_PORT_SLOT: '23' })).toBe(23);
    expect(() => portSlot({ SPARK_TEST_PORT_SLOT: '0' })).toThrow('must be 1 or more');
  });

  it('keeps its data in a throwaway schema of the test database', () => {
    expect(schemaName(1_700_000_000_000)).toBe('turn_tasks_1700000000000');
    const url = new URL(schemaUrl(BASE.TEST_DATABASE_URL, 'turn_tasks_1'));
    expect(url.pathname).toBe('/spark_outpost_test');
    expect(url.searchParams.get('options')).toBe('-c search_path=turn_tasks_1');
  });

  it("runs Spark's fake agent with an in-memory key on a dry run", () => {
    const env = stackEnv({ live: false, dir: '/tmp/x', slot: 17 }, DATABASE, BASE);
    expect(env).toMatchObject({
      DATABASE_URL: DATABASE,
      API_PORT: '20171',
      ALLOWED_ORIGINS: 'http://127.0.0.1:20172',
      AGENT_RUNTIME: 'fake',
      SECRET_STORE: 'memory',
      MEMORY_SECRETS: JSON.stringify({ zai: DRY_RUN_KEY }),
    });
    expect(env.FAKE_ACP_AGENT).toMatch(/apps\/server\/test\/fake-acp-agent\.ts$/);
    expect(env.TEST_DATABASE_URL).toBeUndefined();
    expect(env.BACKUP_DIR).toBeUndefined();
  });

  it("leaves sign-ins and the key store to Spark's own code on a live run", () => {
    const env = stackEnv({ live: true, dir: '/tmp/x', slot: 17 }, DATABASE, BASE);
    expect(env.AGENT_RUNTIME).toBe('acp');
    expect(env.SECRET_STORE).toBe('keychain');
    expect(env.MEMORY_SECRETS).toBeUndefined();
    expect(env.FAKE_ACP_AGENT).toBeUndefined();
    expect(env.DATABASE_URL).toBe(DATABASE);
  });
});
