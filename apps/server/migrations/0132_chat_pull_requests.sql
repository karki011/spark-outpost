ALTER TABLE pr_watches
  ALTER COLUMN task_id DROP NOT NULL,
  ADD COLUMN title text,
  ADD COLUMN base text,
  ADD COLUMN failing_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN review text NOT NULL DEFAULT 'none'
    CHECK (review IN ('none', 'approved', 'changes_requested')),
  ADD COLUMN opened_via text NOT NULL DEFAULT 'ship'
    CHECK (opened_via IN ('ship', 'agent', 'terminal', 'discovery')),
  ADD COLUMN opened_by text,
  ADD COLUMN opened_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  ADD COLUMN outside boolean NOT NULL DEFAULT false,
  ADD COLUMN follow_up boolean NOT NULL DEFAULT true,
  ADD COLUMN status_reason text;

UPDATE pr_watches w SET opened_via = 'agent'
FROM task_links l
WHERE l.task_id = w.task_id AND l.url = w.url AND l.source = 'tool_output';

DELETE FROM pr_watches w USING pr_watches kept
WHERE kept.workspace_id = w.workspace_id AND kept.host = w.host AND kept.number = w.number
  AND lower(kept.owner) = lower(w.owner) AND lower(kept.repo) = lower(w.repo)
  AND (kept.created_at, kept.id) < (w.created_at, w.id);

ALTER TABLE pr_watches
  DROP CONSTRAINT IF EXISTS pr_watches_workspace_id_host_owner_repo_number_key;

CREATE UNIQUE INDEX pr_watches_pull
  ON pr_watches (workspace_id, host, lower(owner), lower(repo), number);

DROP TRIGGER pr_watches_update_change ON pr_watches;
CREATE TRIGGER pr_watches_update_change AFTER UPDATE ON pr_watches
  FOR EACH ROW WHEN (
    (OLD.phase, OLD.doing, OLD.pr_state, OLD.draft, OLD.checks, OLD.rounds, OLD.approval_id,
      OLD.last_error, OLD.title, OLD.branch, OLD.base, OLD.failing_checks, OLD.review,
      OLD.status_reason, OLD.follow_up, OLD.opened_via, OLD.conversation_id)
    IS DISTINCT FROM
    (NEW.phase, NEW.doing, NEW.pr_state, NEW.draft, NEW.checks, NEW.rounds, NEW.approval_id,
      NEW.last_error, NEW.title, NEW.branch, NEW.base, NEW.failing_checks, NEW.review,
      NEW.status_reason, NEW.follow_up, NEW.opened_via, NEW.conversation_id)
  )
  EXECUTE FUNCTION pr_watch_changed();

ALTER TABLE profiles ADD COLUMN pr_follow_up_ask boolean NOT NULL DEFAULT false;
