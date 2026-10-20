ALTER TABLE chat_worktrees
  ADD COLUMN adopted_pull integer CHECK (adopted_pull IS NULL OR adopted_pull > 0),
  ADD COLUMN adopted_author text CHECK (adopted_author IS NULL OR length(adopted_author) <= 100),
  ADD COLUMN adopted_url text CHECK (adopted_url IS NULL OR length(adopted_url) <= 500),
  ADD COLUMN adopted_head text CHECK (adopted_head IS NULL OR length(adopted_head) <= 255),
  ADD COLUMN adopted_pushes boolean,
  ADD CONSTRAINT chat_worktrees_adopted_check CHECK (
    (adopted_pull IS NULL AND adopted_pushes IS NULL)
    OR (adopted_pull IS NOT NULL AND adopted_pushes IS NOT NULL AND adopted_head IS NOT NULL)
  );

ALTER TABLE pr_watches DROP CONSTRAINT IF EXISTS pr_watches_opened_via_check;
ALTER TABLE pr_watches
  ADD CONSTRAINT pr_watches_opened_via_check
  CHECK (opened_via IN ('ship', 'agent', 'terminal', 'discovery', 'adopted'));
