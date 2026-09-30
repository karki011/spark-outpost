ALTER TABLE projects ALTER COLUMN parallel_pieces SET DEFAULT true;
UPDATE projects SET parallel_pieces = true WHERE NOT parallel_pieces;
ALTER TABLE projects DROP COLUMN stable_checkout;
