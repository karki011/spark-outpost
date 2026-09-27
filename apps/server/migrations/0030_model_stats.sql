CREATE TABLE model_stats (
  source text NOT NULL CHECK (source IN ('benchmark')),
  round text NOT NULL,
  measured_on date NOT NULL,
  file text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  agent_model text NOT NULL,
  effort text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('direct', 'scout', 'architect', 'builder', 'critic')),
  category text NOT NULL
    CHECK (category IN ('question', 'fix', 'feature', 'refactor', 'review', 'plan', 'destructive')),
  n integer NOT NULL CHECK (n > 0),
  passed integer NOT NULL CHECK (passed BETWEEN 0 AND n),
  mean_cost_usd numeric NOT NULL CHECK (mean_cost_usd >= 0),
  cost_source text NOT NULL,
  mean_wall_ms integer NOT NULL CHECK (mean_wall_ms >= 0),
  shared_credit integer NOT NULL CHECK (shared_credit BETWEEN 0 AND n),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, round, provider, agent_model, effort, role, category)
);

ALTER TABLE profiles ADD COLUMN allow_frontier jsonb NOT NULL DEFAULT '{}'::jsonb;
