ALTER TABLE native_terminal_sessions
  ADD COLUMN mod_state text CHECK (mod_state IN ('loaded', 'missing')),
  ADD COLUMN mod_reason text,
  ADD COLUMN mod_generation integer,
  ADD COLUMN measure jsonb,
  ADD COLUMN measured_at timestamptz,
  ADD COLUMN ended_reason text,
  ADD COLUMN ended_resume_id text,
  ADD COLUMN ended_at timestamptz;
