CREATE TABLE teammates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  role text NOT NULL DEFAULT '' CHECK (char_length(role) <= 60),
  face_shape text NOT NULL,
  face_color text NOT NULL,
  provider text,
  model text,
  agent_mode text,
  level text CHECK (level IN ('balanced', 'hands-off', 'full-auto')),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 2000),
  home_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX teammates_name_idx ON teammates (workspace_id, lower(name));

CREATE TABLE teammate_projects (
  teammate_id uuid NOT NULL REFERENCES teammates (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (teammate_id, project_id)
);

ALTER TABLE conversations
  ADD COLUMN teammate_id uuid REFERENCES teammates (id) ON DELETE SET NULL;

CREATE INDEX conversations_teammate_idx ON conversations (teammate_id)
  WHERE teammate_id IS NOT NULL;

ALTER TABLE profiles
  ADD COLUMN dismissed_teammate_starters text[] NOT NULL DEFAULT '{}';

CREATE FUNCTION teammate_row_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change('teammate', NULL, NULL);
  RETURN NULL;
END
$$;

CREATE TRIGGER teammates_change AFTER INSERT OR UPDATE OR DELETE ON teammates
  FOR EACH ROW EXECUTE FUNCTION teammate_row_changed();
