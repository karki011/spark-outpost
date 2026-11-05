ALTER TABLE approvals DROP CONSTRAINT approvals_scope_check;
ALTER TABLE approvals
  ADD CONSTRAINT approvals_scope_check CHECK (scope IN ('once', 'run', 'chat', 'project'));
