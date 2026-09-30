import { describe, expect, it } from 'vitest';
import { renumberMigrations } from './migrations.ts';

const MAIN = [
  'apps/server/migrations/0068_drop.sql',
  'apps/server/migrations/0069_parallel.sql',
  'src/app.ts',
];

describe('renumbering migrations at landing', () => {
  it('moves a migration whose number main already uses to the next free number', () => {
    expect(renumberMigrations(['apps/server/migrations/0069_tags.sql'], MAIN)).toEqual([
      {
        from: 'apps/server/migrations/0069_tags.sql',
        to: 'apps/server/migrations/0070_tags.sql',
      },
    ]);
  });

  it('leaves a free number, other folders and unnumbered files alone', () => {
    expect(
      renumberMigrations(
        ['apps/server/migrations/0070_tags.sql', 'src/0069_notes.md', 'migrations/README.md'],
        MAIN,
      ),
    ).toEqual([]);
  });

  it('gives two colliding migrations of one piece distinct numbers', () => {
    const renames = renumberMigrations(
      ['apps/server/migrations/0069_a.sql', 'apps/server/migrations/0069_b.sql'],
      MAIN,
    );
    expect(renames.map((rename) => rename.to)).toEqual([
      'apps/server/migrations/0070_a.sql',
      'apps/server/migrations/0071_b.sql',
    ]);
  });

  it('handles dashes and timestamp prefixes', () => {
    expect(
      renumberMigrations(
        ['db/migrate/20260929120000-add-tags.rb'],
        ['db/migrate/20260929120000-add-users.rb'],
      ),
    ).toEqual([
      {
        from: 'db/migrate/20260929120000-add-tags.rb',
        to: 'db/migrate/20260929120001-add-tags.rb',
      },
    ]);
  });
});
