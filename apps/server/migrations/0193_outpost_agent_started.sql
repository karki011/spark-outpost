ALTER TABLE outpost_posts
  ADD COLUMN agent_started boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT outpost_posts_agent_started_task CHECK (NOT agent_started OR user_started);
