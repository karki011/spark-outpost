import type { TestDb } from './support.ts';

export const PLANTED = {
  username: 'vault-user@example.test',
  password: 'vault-Passw0rd!-planted 9',
};

export const PLANTED_SPELLINGS = [
  PLANTED.username,
  PLANTED.password,
  encodeURIComponent(PLANTED.username),
  encodeURIComponent(PLANTED.password),
  encodeURIComponent(PLANTED.password).replace(/%20/g, '+'),
];

export async function everyStoredValue(t: TestDb): Promise<string> {
  const tables = await t.db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
  );
  const dumps = await Promise.all(
    tables.rows.map(async ({ table_name }) => {
      const { rows } = await t.db.query<{ line: string }>(
        `SELECT row_to_json(stored)::text AS line FROM "${table_name}" stored`,
      );
      return rows.map((row) => `${table_name} ${row.line}`).join('\n');
    }),
  );
  return dumps.join('\n');
}

export function plantedIn(text: string): string[] {
  return PLANTED_SPELLINGS.filter((spelling) => text.includes(spelling));
}
