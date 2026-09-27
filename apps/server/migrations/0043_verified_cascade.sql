ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (
  kind IN (
    'edit', 'execute', 'other', 'clarify', 'plan', 'retry', 'accept', 'budget', 'merge_conflict',
    'stuck', 'verify'
  )
);
