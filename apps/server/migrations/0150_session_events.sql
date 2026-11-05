ALTER TABLE provider_sessions
  ADD COLUMN model text,
  ADD COLUMN agent_mode text;

CREATE TABLE provider_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  session_row_id uuid REFERENCES provider_sessions (id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event text NOT NULL CHECK (event IN ('open', 'resume', 'replace', 'model_change', 'close')),
  reason text,
  body jsonb NOT NULL
);

CREATE INDEX provider_session_events_conversation
  ON provider_session_events (conversation_id, at);

CREATE FUNCTION record_provider_session_close() RETURNS trigger AS $$
BEGIN
  INSERT INTO provider_session_events (conversation_id, session_row_id, event, reason, body)
  VALUES (
    NEW.conversation_id,
    NEW.id,
    'close',
    NEW.close_reason,
    jsonb_build_object(
      'event', 'close',
      'reason', NEW.close_reason,
      'kept', true,
      'provider', NEW.provider,
      'agentKey', NEW.agent_key,
      'sessionId', NEW.session_id,
      'model', NEW.model,
      'carriedTokens', NEW.context_used,
      'cacheWriteUsd', NULL
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provider_sessions_close_event
  AFTER UPDATE OF closed_at ON provider_sessions
  FOR EACH ROW
  WHEN (OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL)
  EXECUTE FUNCTION record_provider_session_close();
