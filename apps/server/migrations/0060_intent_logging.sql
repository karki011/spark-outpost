ALTER TABLE runs
  ADD COLUMN picked_mode text CHECK (picked_mode IN ('chat', 'ask', 'do')),
  ADD COLUMN start_as text CHECK (start_as IN ('change')),
  ADD COLUMN source text CHECK (source IN ('ui', 'e2e', 'bench', 'digest', 'ticket')),
  ADD COLUMN project_roots text[];

ALTER TABLE approvals ADD COLUMN default_option_id text;
