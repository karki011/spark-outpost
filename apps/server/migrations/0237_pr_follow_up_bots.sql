ALTER TABLE profiles ADD COLUMN pr_follow_up_bots text[] NOT NULL DEFAULT '{}';

ALTER TABLE pr_watches ADD COLUMN known_reviewers text[] NOT NULL DEFAULT '{}';
ALTER TABLE pr_watches ADD COLUMN quiet_head text;
