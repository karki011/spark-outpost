ALTER TABLE remote_sparks
  ADD COLUMN icon bytea CHECK (icon IS NULL OR octet_length(icon) BETWEEN 1 AND 65536);

CREATE TABLE local_spark (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 60),
  icon bytea CHECK (icon IS NULL OR octet_length(icon) BETWEEN 1 AND 65536)
);
