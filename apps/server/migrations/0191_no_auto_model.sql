UPDATE conversations SET
  overrides = (
    SELECT COALESCE(
      jsonb_object_agg(
        provider,
        CASE WHEN jsonb_typeof(choices) = 'object' THEN choices - 'model' ELSE choices END
      ),
      '{}'::jsonb
    )
    FROM jsonb_each(overrides) AS entry(provider, choices)
  ),
  model_routing = 'pinned'
WHERE model_routing = 'auto';

ALTER TABLE conversations ALTER COLUMN model_routing SET DEFAULT 'pinned';

ALTER TABLE orchestrations ALTER COLUMN routing SET DEFAULT 'pinned';
