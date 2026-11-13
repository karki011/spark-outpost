DELETE FROM teammates WHERE kind IS NOT NULL;

DROP INDEX teammates_kind_idx;
ALTER TABLE teammates DROP COLUMN kind;

ALTER TABLE profiles DROP COLUMN relay_seeded_at;
