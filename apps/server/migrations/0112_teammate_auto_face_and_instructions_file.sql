ALTER TABLE teammates
  ALTER COLUMN face_shape DROP NOT NULL,
  ALTER COLUMN face_color DROP NOT NULL,
  ADD COLUMN instructions_path text CHECK (char_length(instructions_path) <= 1024),
  ADD CONSTRAINT teammates_face_pair CHECK ((face_shape IS NULL) = (face_color IS NULL));
