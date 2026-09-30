ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (
  kind IN (
    'edit', 'execute', 'other', 'spark_action', 'clarify', 'plan', 'retry', 'accept', 'budget',
    'merge_conflict', 'stuck', 'verify', 'pieces', 'ownership'
  )
);

ALTER TABLE approvals ADD COLUMN edits jsonb;

ALTER TABLE ticket_events DROP CONSTRAINT ticket_events_action_check;
ALTER TABLE ticket_events
  ADD CONSTRAINT ticket_events_action_check CHECK (
    action IN (
      'connect', 'disconnect', 'settings', 'start', 'transition', 'comment', 'link_pr', 'assign',
      'create'
    )
  );
