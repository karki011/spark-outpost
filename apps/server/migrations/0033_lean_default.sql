ALTER TABLE projects
  ALTER COLUMN build_style DROP NOT NULL,
  ALTER COLUMN build_style DROP DEFAULT;

UPDATE projects SET build_style = NULL WHERE build_style = 'off';
