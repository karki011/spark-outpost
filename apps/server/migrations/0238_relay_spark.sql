ALTER TABLE teammates ADD COLUMN kind text CHECK (kind IN ('pr_follow_up'));
CREATE UNIQUE INDEX teammates_kind_idx ON teammates (workspace_id, kind) WHERE kind IS NOT NULL;

ALTER TABLE profiles ADD COLUMN relay_seeded_at timestamptz;

ALTER TABLE pr_watches ADD COLUMN merge_round_for text;
ALTER TABLE pr_watches ADD COLUMN round_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb;
