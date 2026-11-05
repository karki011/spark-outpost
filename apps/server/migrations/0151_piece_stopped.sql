ALTER TABLE task_pieces DROP CONSTRAINT task_pieces_status_check;
ALTER TABLE task_pieces ADD CONSTRAINT task_pieces_status_check CHECK (
  status IN ('pending', 'ready', 'running', 'landed', 'skipped', 'failed', 'stopped')
);
