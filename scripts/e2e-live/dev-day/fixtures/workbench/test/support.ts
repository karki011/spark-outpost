import { migrate, openDb } from '../src/db.ts';

export function freshDb() {
  const db = openDb();
  migrate(db);
  return db;
}
