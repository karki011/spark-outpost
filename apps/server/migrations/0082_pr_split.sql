ALTER TABLE projects ADD COLUMN pr_split text CHECK (pr_split IN ('one', 'separate'));

ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (
  kind IN (
    'edit', 'execute', 'other', 'spark_action', 'clarify', 'plan', 'retry', 'accept', 'budget',
    'merge_conflict', 'stuck', 'verify', 'pieces', 'ownership', 'pr_split'
  )
);
