CREATE TABLE map_area_notes (
  root_path text NOT NULL,
  area_id text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array'),
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  written_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (root_path, area_id)
);
