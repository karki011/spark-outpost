ALTER TABLE profiles
  ADD COLUMN assistant_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL;
