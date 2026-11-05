CREATE TABLE conversation_projects (
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, project_id)
);

CREATE INDEX conversation_projects_project_idx ON conversation_projects (project_id);

INSERT INTO conversation_projects (conversation_id, project_id, position)
SELECT id, project_id, 0 FROM conversations WHERE project_id IS NOT NULL;

DROP INDEX conversations_project_idx;

ALTER TABLE conversations DROP COLUMN project_id;
