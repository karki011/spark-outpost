ALTER TABLE outpost_posts
  ADD COLUMN attachment_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN opening boolean NOT NULL DEFAULT false;
