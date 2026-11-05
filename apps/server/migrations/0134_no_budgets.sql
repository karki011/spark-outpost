UPDATE approvals
SET status = 'allowed',
    decided_by = 'policy',
    decision_option_id = 'continue',
    scope = 'once',
    decided_at = now()
WHERE kind = 'budget' AND status = 'pending';

ALTER TABLE orchestrations
  DROP COLUMN active_limit_ms,
  DROP COLUMN tool_call_limit,
  DROP COLUMN cost_cap_usd,
  DROP COLUMN exceeded;

ALTER TABLE profiles DROP COLUMN spend_cap_usd;
