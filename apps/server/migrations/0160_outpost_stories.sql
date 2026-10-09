CREATE TABLE outpost_drafts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  outpost_id uuid REFERENCES outposts (id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  body jsonb NOT NULL,
  started_at timestamptz,
  reported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outpost_drafts_conversation ON outpost_drafts (conversation_id, created_at);
CREATE INDEX outpost_drafts_outpost ON outpost_drafts (outpost_id) WHERE outpost_id IS NOT NULL;

ALTER TABLE outpost_posts
  ADD COLUMN after_post_id uuid REFERENCES outpost_posts (id) ON DELETE SET NULL,
  ADD COLUMN user_started boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT outpost_posts_after_other CHECK (after_post_id <> id);

CREATE INDEX outpost_posts_after ON outpost_posts (after_post_id) WHERE after_post_id IS NOT NULL;

CREATE TABLE outpost_story_tasks (
  conversation_id uuid PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  outpost_id uuid NOT NULL REFERENCES outposts (id) ON DELETE CASCADE,
  draft_id uuid REFERENCES outpost_drafts (id) ON DELETE SET NULL,
  lead_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  position integer NOT NULL,
  depends_on_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  opening_post_id uuid REFERENCES outpost_posts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outpost_story_tasks_depends_on_other
    CHECK (depends_on_conversation_id <> conversation_id)
);

CREATE INDEX outpost_story_tasks_story ON outpost_story_tasks (outpost_id, draft_id, position);
CREATE INDEX outpost_story_tasks_depends_on ON outpost_story_tasks (depends_on_conversation_id)
  WHERE depends_on_conversation_id IS NOT NULL;

CREATE FUNCTION outpost_story_task_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_outpost_changed(NEW.outpost_id);
  RETURN NULL;
END
$$;

CREATE FUNCTION outpost_pull_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_outpost_changed(m.outpost_id)
  FROM outpost_members m WHERE m.conversation_id = NEW.conversation_id;
  RETURN NULL;
END
$$;

CREATE TRIGGER outpost_story_tasks_insert_change AFTER INSERT ON outpost_story_tasks
  FOR EACH ROW EXECUTE FUNCTION outpost_story_task_changed();

CREATE TRIGGER pr_watches_insert_outpost_change AFTER INSERT ON pr_watches
  FOR EACH ROW EXECUTE FUNCTION outpost_pull_changed();
CREATE TRIGGER pr_watches_state_outpost_change
  AFTER UPDATE OF pr_state, base, draft, head_sha ON pr_watches
  FOR EACH ROW WHEN (
    (OLD.pr_state, OLD.base, OLD.draft, OLD.head_sha)
    IS DISTINCT FROM
    (NEW.pr_state, NEW.base, NEW.draft, NEW.head_sha)
  )
  EXECUTE FUNCTION outpost_pull_changed();
