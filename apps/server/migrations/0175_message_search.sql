CREATE FUNCTION search_vector(body text) RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT to_tsvector(
      'simple'::regconfig,
      regexp_replace(left(body, 100000), '[[:punct:]]+', ' ', 'g')
    )
  $$;

ALTER TABLE messages
  ADD COLUMN search tsvector GENERATED ALWAYS AS (search_vector(content)) STORED;

CREATE INDEX messages_search_idx ON messages USING gin (search);
