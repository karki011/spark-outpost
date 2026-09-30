CREATE TABLE project_budgets (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id),
  amount INTEGER NOT NULL
);
