ALTER TABLE assistant_events DROP CONSTRAINT assistant_events_kind_check;

ALTER TABLE assistant_events ADD CONSTRAINT assistant_events_kind_check CHECK (kind IN (
  'session_started', 'session_resumed', 'session_reseeded', 'compacted_threshold',
  'compacted_idle', 'settings_changed', 'fact_added', 'fact_removed', 'history_cleared',
  'topic_started'
));
