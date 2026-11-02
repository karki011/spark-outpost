ALTER TABLE member_messages ADD COLUMN attachment_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE member_messages ADD COLUMN annotations jsonb NOT NULL DEFAULT '[]';
ALTER TABLE chat_queue ADD COLUMN annotations jsonb NOT NULL DEFAULT '[]';
