ALTER TABLE projects
  ADD COLUMN parallel_pieces boolean NOT NULL DEFAULT false,
  ADD COLUMN piece_slots smallint NOT NULL DEFAULT 3 CHECK (piece_slots BETWEEN 1 AND 3);
