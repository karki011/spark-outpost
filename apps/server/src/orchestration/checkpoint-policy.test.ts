import { describe, expect, it } from 'vitest';
import {
  asksToKeep,
  confirmsRiskyFirst,
  DESTRUCTIVE_CARD_REASON,
  keepReason,
  keepsByItself,
  MIGRATION_CARD_REASON,
  riskyChange,
} from './checkpoint-policy.ts';
import { destructiveByRule, destructiveMigrationInPatch } from './risk-rules.ts';
import { riskyCard, RISKY_CARD_TITLE } from './checkpoint.ts';

/** The developer's-day tags story (s11): an additive CREATE TABLE migration. */
const S11 = [
  'Add tags to projects, end to end:',
  '- Database: a new migration that stores tags per project. Existing databases must upgrade and their projects start with no tags.',
  '- API: `PUT /projects/:id/tags` with `{ "tags": [...] }` replaces the project\'s tags and answers 200 `{ tags }`. Tags are trimmed, lowercased, de-duplicated and sorted; a blank or non-string tag is a 400, an unknown project a 404. `GET /projects` and `GET /projects/:id` include `tags: string[]` on every project.',
  '- UI: `renderProjectRow` shows each tag after the name as `<span class="tag">name</span>`, escaped.',
  'Add tests for each part.',
].join('\n');

const S11_PATCH = `diff --git a/migrations/004_project_tags.sql b/migrations/004_project_tags.sql
new file mode 100644
--- /dev/null
+++ b/migrations/004_project_tags.sql
@@ -0,0 +1,6 @@
+-- Tags per project; existing projects start with none.
+CREATE TABLE IF NOT EXISTS project_tags (
+  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
+  tag TEXT NOT NULL,
+  PRIMARY KEY (project_id, tag)
+);
+CREATE INDEX project_tags_tag ON project_tags (tag);
diff --git a/src/projects.ts b/src/projects.ts
--- a/src/projects.ts
+++ b/src/projects.ts
@@ -1,2 +1,3 @@
+db.prepare('DELETE FROM project_tags').run();
`;

const migration = (sql: string, file = 'migrations/005_x.sql') =>
  `diff --git a/${file} b/${file}\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n${sql
    .split('\n')
    .map((line) => `+${line}`)
    .join('\n')}\n`;

const S10 =
  "Rename the `amount` column on `expenses` to `amount_cents` (it has always held cents). People have existing databases full of data, so add a new migration that keeps every row, and update the code and tests. Keep the API's JSON field names as they are.";

describe('risky work', () => {
  it('flags destructive work and destructive migrations, not ordinary changes', () => {
    expect(riskyChange(true, 'tidy the README')).toBe(DESTRUCTIVE_CARD_REASON);
    expect(riskyChange(false, S10)).not.toBeNull();
    expect(destructiveByRule(S10)).toBe(true);
    expect(riskyChange(false, 'Write a migration that drops the legacy_notes column')).toBe(
      MIGRATION_CARD_REASON,
    );
    expect(
      riskyChange(false, 'Add a migration that changes the amount column type to bigint'),
    ).toBe(MIGRATION_CARD_REASON);
    expect(riskyChange(false, 'Fix the typo in the spend summary')).toBeNull();
  });

  it('does not flag additive migrations (N3): new tables, nullable columns, indexes', () => {
    expect(destructiveByRule(S11)).toBe(false);
    expect(riskyChange(false, S11)).toBeNull();
    for (const request of [
      'Add a migration for a tags table',
      'Add a migration that adds a nullable `archived_at` column to projects',
      'Write a migration that creates an index on expenses(project_id)',
    ]) {
      expect(destructiveByRule(request), request).toBe(false);
      expect(riskyChange(false, request), request).toBeNull();
    }
  });
});

describe('the migration diff', () => {
  it("reads s11's CREATE TABLE and CREATE INDEX as additive, and ignores non-migration files", () => {
    expect(destructiveMigrationInPatch(S11_PATCH)).toBeNull();
    expect(
      destructiveMigrationInPatch(migration('ALTER TABLE projects ADD COLUMN archived_at TEXT;')),
    ).toBeNull();
    expect(destructiveMigrationInPatch('')).toBeNull();
  });

  it('finds drops, renames, type changes, truncates and unscoped writes', () => {
    for (const sql of [
      'ALTER TABLE expenses RENAME COLUMN amount TO amount_cents;',
      'ALTER TABLE expenses DROP COLUMN note;',
      'DROP TABLE legacy_notes;',
      'ALTER TABLE expenses ALTER COLUMN amount TYPE bigint;',
      'TRUNCATE expenses;',
      'DELETE FROM expenses;',
      'UPDATE expenses SET amount = amount * 100;',
      'ALTER TABLE expenses RENAME TO costs;',
    ]) {
      expect(destructiveMigrationInPatch(migration(sql)), sql).not.toBeNull();
    }
    expect(destructiveMigrationInPatch(migration("DELETE FROM tags WHERE tag = '';"))).toBeNull();
    expect(
      destructiveMigrationInPatch(
        migration(
          "exports.up = (knex) => knex.schema.table('t', (t) => t.dropColumn('c'));",
          'db/migrate/006.js',
        ),
      ),
    ).not.toBeNull();
  });
});

describe('risky migrations found after the Builder', () => {
  it('ask to keep at Auto-edit and say why', () => {
    const facts = {
      checksFailing: false,
      criticUnsatisfied: false,
      riskyMigration: 'ALTER TABLE expenses DROP COLUMN note',
    };
    expect(asksToKeep('hands-off', 2, facts)).toBe(true);
    expect(keepReason('hands-off', facts)).toBe(
      'Auto-edit asks because the migration it added can lose or rewrite existing data (`ALTER TABLE expenses DROP COLUMN note`).',
    );
    expect(asksToKeep('full-auto', 2, facts)).toBe(false);
  });
});

describe('the risky card', () => {
  it('asks first at Ask before edits and Auto-edit, not at Full auto', () => {
    expect(confirmsRiskyFirst('balanced')).toBe(true);
    expect(confirmsRiskyFirst('hands-off')).toBe(true);
    expect(confirmsRiskyFirst('full-auto')).toBe(false);
  });

  it('offers Build it or Stop on the card', () => {
    const card = riskyCard(DESTRUCTIVE_CARD_REASON);
    expect(card).toMatchObject({ kind: 'plan', title: RISKY_CARD_TITLE });
    expect(card.options.map((option) => option.name)).toEqual(['Build it', 'Stop']);
  });
});

describe('keep card', () => {
  const settled = { checksFailing: false, criticUnsatisfied: false };

  it('always asks at Ask before edits when files changed', () => {
    expect(asksToKeep('balanced', 2, settled)).toBe(true);
    expect(asksToKeep('balanced', 0, settled)).toBe(false);
  });

  it('asks at Auto-edit only when checks fail or the Critic is not satisfied', () => {
    expect(asksToKeep('hands-off', 2, settled)).toBe(false);
    expect(keepsByItself('hands-off', 2)).toBe(true);
    expect(asksToKeep('hands-off', 2, { ...settled, checksFailing: true })).toBe(true);
    expect(asksToKeep('hands-off', 2, { ...settled, criticUnsatisfied: true })).toBe(true);
    expect(keepsByItself('hands-off', 0)).toBe(false);
  });

  it('never asks at Full auto, which keeps and ships', () => {
    expect(asksToKeep('full-auto', 2, { checksFailing: true, criticUnsatisfied: true })).toBe(
      false,
    );
    expect(keepsByItself('full-auto', 2)).toBe(false);
  });
});
