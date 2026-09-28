CREATE TABLE project_tags (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (project_id, tag)
);
