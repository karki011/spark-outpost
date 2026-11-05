ALTER TABLE conversations
  ADD COLUMN title_source text NOT NULL DEFAULT 'message'
    CHECK (title_source IN ('message', 'auto', 'user')),
  ADD COLUMN title_category text;

ALTER TABLE runs
  ADD COLUMN category text,
  ADD COLUMN suggested_title text;

UPDATE conversations c SET title_source = 'user'
WHERE c.title <> 'New chat'
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = c.id AND m.role = 'user'
      AND m.created_at = (
        SELECT min(first.created_at) FROM messages first
        WHERE first.conversation_id = c.id AND first.role = 'user'
      )
      AND (
        btrim(m.content) = ''
        OR starts_with(
          btrim(split_part(btrim(m.content, E' \t\r\n'), E'\n', 1), E' \t\r'),
          rtrim(c.title, E' .…')
        )
      )
  );
