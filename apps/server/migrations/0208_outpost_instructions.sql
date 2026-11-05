ALTER TABLE outposts
  ADD COLUMN instructions text NOT NULL DEFAULT ''
  CONSTRAINT outposts_instructions_length CHECK (char_length(instructions) <= 4000);
