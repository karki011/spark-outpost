ALTER TABLE profiles
  ADD COLUMN pr_ready_for_review boolean NOT NULL DEFAULT true,
  ADD COLUMN pr_follow_up boolean NOT NULL DEFAULT true,
  ADD COLUMN pr_follow_up_checks boolean NOT NULL DEFAULT true,
  ADD COLUMN pr_follow_up_reviews boolean NOT NULL DEFAULT true,
  ADD COLUMN pr_follow_up_replies boolean NOT NULL DEFAULT true;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN ('ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up'));

CREATE TABLE pr_watches (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  host text NOT NULL,
  owner text NOT NULL,
  repo text NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  url text NOT NULL,
  branch text NOT NULL,
  phase text NOT NULL DEFAULT 'watching'
    CHECK (phase IN ('watching', 'fixing', 'confirming', 'needs_you', 'done')),
  doing text NOT NULL DEFAULT '',
  pr_state text NOT NULL DEFAULT 'open' CHECK (pr_state IN ('open', 'merged', 'closed')),
  draft boolean NOT NULL DEFAULT false,
  checks text NOT NULL DEFAULT 'none' CHECK (checks IN ('none', 'pending', 'passing', 'failing')),
  head_sha text,
  rounds integer NOT NULL DEFAULT 0,
  round_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  approval_id uuid REFERENCES approvals (id) ON DELETE SET NULL,
  requested boolean NOT NULL DEFAULT false,
  interval_seconds integer NOT NULL DEFAULT 120,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, host, owner, repo, number)
);

CREATE INDEX pr_watches_due ON pr_watches (next_poll_at) WHERE phase <> 'done';
CREATE INDEX pr_watches_conversation ON pr_watches (conversation_id);

CREATE TABLE pr_feedback_items (
  id uuid PRIMARY KEY,
  watch_id uuid NOT NULL REFERENCES pr_watches (id) ON DELETE CASCADE,
  source_key text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('check', 'review_comment', 'review', 'issue_comment')),
  github_id text NOT NULL,
  author text NOT NULL,
  trusted boolean NOT NULL,
  path text,
  line integer,
  body text NOT NULL,
  url text,
  triage text NOT NULL
    CHECK (triage IN ('fix', 'question', 'disagree', 'nit', 'addressed', 'info')),
  triaged_by text NOT NULL CHECK (triaged_by IN ('jev', 'rules')),
  state text NOT NULL
    CHECK (state IN ('queued', 'held', 'needs_user', 'in_round', 'planned', 'done', 'skipped')),
  round integer,
  reply text,
  reply_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watch_id, source_key),
  UNIQUE (watch_id, label)
);

CREATE INDEX pr_feedback_items_state ON pr_feedback_items (watch_id, state);

CREATE FUNCTION pr_watch_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change('pull_request', NEW.conversation_id, NULL);
  RETURN NULL;
END
$$;

CREATE FUNCTION pr_feedback_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change('pull_request', w.conversation_id, NULL)
    FROM pr_watches w WHERE w.id = NEW.watch_id;
  RETURN NULL;
END
$$;

CREATE TRIGGER pr_watches_insert_change AFTER INSERT ON pr_watches
  FOR EACH ROW EXECUTE FUNCTION pr_watch_changed();
CREATE TRIGGER pr_watches_update_change AFTER UPDATE ON pr_watches
  FOR EACH ROW WHEN (
    (OLD.phase, OLD.doing, OLD.pr_state, OLD.draft, OLD.checks, OLD.rounds, OLD.approval_id,
      OLD.last_error)
    IS DISTINCT FROM
    (NEW.phase, NEW.doing, NEW.pr_state, NEW.draft, NEW.checks, NEW.rounds, NEW.approval_id,
      NEW.last_error)
  )
  EXECUTE FUNCTION pr_watch_changed();
CREATE TRIGGER pr_feedback_items_change AFTER INSERT OR UPDATE OF state ON pr_feedback_items
  FOR EACH ROW EXECUTE FUNCTION pr_feedback_changed();
