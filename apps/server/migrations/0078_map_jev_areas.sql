ALTER TABLE map_repos ADD COLUMN jev_areas integer CHECK (jev_areas >= 0);
