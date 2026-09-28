import { afterEach, expect, it, vi } from 'vitest';
import { testDatabaseUrl } from './test-database.ts';

const DEV = 'postgres://spark:secret@127.0.0.1:54329/spark_outpost';

afterEach(() => {
  vi.unstubAllEnvs();
});

function withUrls(test: string | undefined, dev: string | undefined = DEV): string {
  vi.stubEnv('TEST_DATABASE_URL', test);
  vi.stubEnv('DATABASE_URL', dev);
  return testDatabaseUrl();
}

it('accepts a separate *_test database, with or without a suffix', () => {
  expect(withUrls('postgres://spark:secret@127.0.0.1:54329/spark_outpost_test')).toMatch(/_test$/);
  expect(withUrls('postgres://spark:secret@127.0.0.1:54329/spark_outpost_test_stab')).toMatch(
    /_test_stab$/,
  );
});

it('rejects names that only contain _test inside a word', () => {
  expect(() => withUrls('postgres://spark:secret@127.0.0.1:54329/spark_outpost_testing')).toThrow(
    /separate \*_test database/,
  );
  expect(() => withUrls('postgres://spark:secret@127.0.0.1:54329/my_testdb')).toThrow(
    /separate \*_test database/,
  );
});

it('rejects the dev database and a missing URL', () => {
  expect(() => withUrls(DEV, DEV)).toThrow(/never the dev one/);
  expect(() => withUrls(undefined)).toThrow(/needs TEST_DATABASE_URL/);
});
