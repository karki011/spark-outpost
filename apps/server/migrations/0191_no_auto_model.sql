UPDATE conversations SET overrides = (
  SELECT COALESCE(
    jsonb_object_agg(
      provider,
      CASE WHEN jsonb_typeof(choices) = 'object' THEN choices - 'model' ELSE choices END
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(overrides) AS entry(provider, choices)
)
WHERE model_routing = 'auto' AND overrides <> '{}'::jsonb;

ALTER TABLE conversations DROP COLUMN model_routing;

ALTER TABLE orchestrations DROP COLUMN routing;
