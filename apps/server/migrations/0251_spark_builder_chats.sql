ALTER TABLE crew_builder_chats
  ADD COLUMN for_spark boolean NOT NULL DEFAULT false,
  ADD COLUMN spark_id uuid REFERENCES teammates (id) ON DELETE SET NULL,
  ADD CONSTRAINT crew_builder_chats_spark CHECK (for_spark OR spark_id IS NULL);

CREATE INDEX crew_builder_chats_spark ON crew_builder_chats (spark_id, created_at DESC)
  WHERE spark_id IS NOT NULL;
