ALTER TABLE task_links DROP CONSTRAINT task_links_kind_check;
ALTER TABLE task_links
  ADD CONSTRAINT task_links_kind_check CHECK (kind IN ('pr', 'link', 'file', 'folder'));
