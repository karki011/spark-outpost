ALTER TABLE pr_watches ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP TRIGGER pr_watches_update_change ON pr_watches;
CREATE TRIGGER pr_watches_update_change AFTER UPDATE ON pr_watches
  FOR EACH ROW WHEN (
    (OLD.phase, OLD.doing, OLD.pr_state, OLD.draft, OLD.checks, OLD.rounds, OLD.approval_id,
      OLD.last_error, OLD.title, OLD.branch, OLD.base, OLD.failing_checks, OLD.review,
      OLD.status_reason, OLD.follow_up, OLD.opened_via, OLD.conversation_id, OLD.details)
    IS DISTINCT FROM
    (NEW.phase, NEW.doing, NEW.pr_state, NEW.draft, NEW.checks, NEW.rounds, NEW.approval_id,
      NEW.last_error, NEW.title, NEW.branch, NEW.base, NEW.failing_checks, NEW.review,
      NEW.status_reason, NEW.follow_up, NEW.opened_via, NEW.conversation_id, NEW.details)
  )
  EXECUTE FUNCTION pr_watch_changed();
