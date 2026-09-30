ALTER TABLE piece_notes
  ALTER COLUMN piece_id DROP NOT NULL,
  ADD COLUMN piece_list_id uuid REFERENCES piece_lists (id) ON DELETE CASCADE,
  ADD CONSTRAINT piece_notes_target_check CHECK (piece_id IS NOT NULL OR piece_list_id IS NOT NULL);

CREATE INDEX piece_notes_pending_idx ON piece_notes (piece_id) WHERE delivered_at IS NULL;
CREATE INDEX piece_notes_list_pending_idx ON piece_notes (piece_list_id) WHERE delivered_at IS NULL;
