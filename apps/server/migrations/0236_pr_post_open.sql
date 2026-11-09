ALTER TABLE pr_watches
  ADD COLUMN ticket_sync_claimed_at timestamptz,
  ADD COLUMN ticket_sync jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN clean_head_sha text,
  ADD COLUMN clean_since timestamptz;

UPDATE pr_watches SET ticket_sync_claimed_at = created_at;

DROP TRIGGER pr_watches_update_change ON pr_watches;
CREATE TRIGGER pr_watches_update_change AFTER UPDATE ON pr_watches
  FOR EACH ROW WHEN (
    (OLD.phase, OLD.doing, OLD.pr_state, OLD.draft, OLD.checks, OLD.rounds, OLD.approval_id,
      OLD.last_error, OLD.title, OLD.branch, OLD.base, OLD.failing_checks, OLD.review,
      OLD.status_reason, OLD.follow_up, OLD.opened_via, OLD.conversation_id, OLD.details,
      OLD.poll_problem, OLD.round_run_id, OLD.additions, OLD.deletions, OLD.ticket_sync,
      OLD.clean_head_sha, OLD.clean_since)
    IS DISTINCT FROM
    (NEW.phase, NEW.doing, NEW.pr_state, NEW.draft, NEW.checks, NEW.rounds, NEW.approval_id,
      NEW.last_error, NEW.title, NEW.branch, NEW.base, NEW.failing_checks, NEW.review,
      NEW.status_reason, NEW.follow_up, NEW.opened_via, NEW.conversation_id, NEW.details,
      NEW.poll_problem, NEW.round_run_id, NEW.additions, NEW.deletions, NEW.ticket_sync,
      NEW.clean_head_sha, NEW.clean_since)
    OR (
      NEW.phase IN ('watching', 'needs_you')
      AND OLD.last_polled_at IS DISTINCT FROM NEW.last_polled_at
    )
  )
  EXECUTE FUNCTION pr_watch_changed();
