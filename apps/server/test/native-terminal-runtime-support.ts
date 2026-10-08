import type { Db } from '../src/persistence/db.ts';

export async function failNativeWriteOnce(db: Db, state: 'working' | 'ready' | 'succeeded') {
  const table = state === 'succeeded' ? 'runs' : 'native_terminal_sessions';
  const column = state === 'succeeded' ? 'status' : 'state';
  await db.query(`CREATE SEQUENCE native_write_failures;
    CREATE FUNCTION fail_native_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF nextval('native_write_failures') = 1 THEN
        RAISE EXCEPTION 'Transient native write fixture failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER native_write_failure BEFORE UPDATE ON ${table}
    FOR EACH ROW WHEN (NEW.${column} = '${state}') EXECUTE FUNCTION fail_native_write_once()`);
}

export async function clearNativeWriteFailure(db: Db) {
  await db.query(`DROP TRIGGER IF EXISTS native_write_failure ON native_terminal_sessions;
    DROP TRIGGER IF EXISTS native_write_failure ON runs;
    DROP FUNCTION IF EXISTS fail_native_write_once();
    DROP SEQUENCE IF EXISTS native_write_failures`);
}
