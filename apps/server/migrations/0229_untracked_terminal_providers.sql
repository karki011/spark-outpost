ALTER TABLE conversations DROP CONSTRAINT conversations_terminal_provider_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_terminal_provider_check
  CHECK (terminal_provider IN ('claude', 'codex', 'gemini', 'opencode', 'amp'));

ALTER TABLE native_terminal_sessions DROP CONSTRAINT native_terminal_sessions_provider_check;
ALTER TABLE native_terminal_sessions ADD CONSTRAINT native_terminal_sessions_provider_check
  CHECK (provider IN ('claude', 'codex', 'gemini', 'opencode', 'amp'));
