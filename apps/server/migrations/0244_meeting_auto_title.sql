ALTER TABLE meetings
  ADD COLUMN title_origin text NOT NULL DEFAULT 'given'
    CHECK (title_origin IN ('default', 'given', 'auto'));

UPDATE meetings SET title_origin = 'default' WHERE source = 'adhoc' AND title = 'Untitled meeting';

ALTER TABLE calendar_connection ADD COLUMN notes_on_join boolean NOT NULL DEFAULT false;
