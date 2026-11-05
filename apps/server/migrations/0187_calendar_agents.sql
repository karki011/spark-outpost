ALTER TABLE calendar_calendars ADD COLUMN agents_edit boolean NOT NULL DEFAULT false;

ALTER TABLE calendar_google_accounts ADD COLUMN can_edit boolean NOT NULL DEFAULT false;

ALTER TABLE run_observations DROP CONSTRAINT run_observations_source_check;
ALTER TABLE run_observations
  ADD CONSTRAINT run_observations_source_check CHECK (
    source IN ('secret_file', 'secret_output', 'private_data', 'web_page', 'mac_app', 'calendar')
  );
