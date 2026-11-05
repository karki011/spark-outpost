UPDATE provider_connections SET model = NULL
WHERE (provider = 'claude' AND model IN ('haiku', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001'))
   OR (provider = 'codex' AND model = 'gpt-5.5');
