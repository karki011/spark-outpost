ALTER TABLE attachments DROP CONSTRAINT attachments_kind_check;
ALTER TABLE attachments
  ADD CONSTRAINT attachments_kind_check CHECK (kind IN ('image', 'text', 'file'));
