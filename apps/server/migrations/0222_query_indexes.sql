CREATE INDEX IF NOT EXISTS messages_run_created_idx ON messages (run_id, created_at)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS run_events_step_activity_idx ON run_events (run_id, seq)
  WHERE type IN ('STEP_STARTED', 'STEP_FINISHED', 'REASONING_START');
DROP INDEX IF EXISTS run_events_steps_idx;

CREATE INDEX IF NOT EXISTS runs_user_message_idx ON runs (user_message_id)
  WHERE user_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_session_events_run_idx ON provider_session_events (run_id)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_session_events_session_row_idx
  ON provider_session_events (session_row_id) WHERE session_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS preview_events_run_idx ON preview_events (run_id)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS preview_events_conversation_idx ON preview_events (conversation_id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assistant_events_run_idx ON assistant_events (run_id)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assistant_facts_message_idx ON assistant_facts (message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compactions_run_idx ON compactions (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compactions_from_run_idx ON compactions (from_run_id)
  WHERE from_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compactions_last_message_idx ON compactions (last_message_id)
  WHERE last_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compactions_session_row_idx ON compactions (session_row_id)
  WHERE session_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rail_flags_run_idx ON rail_flags (run_id);
CREATE INDEX IF NOT EXISTS browser_screenshots_run_idx ON browser_screenshots (run_id);
CREATE INDEX IF NOT EXISTS browser_screenshots_attachment_idx ON browser_screenshots (attachment_id);
CREATE INDEX IF NOT EXISTS artifact_page_versions_run_idx ON artifact_page_versions (run_id)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS member_messages_delivered_run_idx ON member_messages (delivered_run_id)
  WHERE delivered_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS slack_events_conversation_idx ON slack_events (conversation_id)
  WHERE conversation_id IS NOT NULL;
