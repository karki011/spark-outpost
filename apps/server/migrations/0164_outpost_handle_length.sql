ALTER TABLE outpost_members DROP CONSTRAINT outpost_members_handle_check;

ALTER TABLE outpost_members
  ADD CONSTRAINT outpost_members_handle_check
  CHECK (handle ~ '^[a-z][a-z0-9-]{1,31}$' AND handle <> 'all');
