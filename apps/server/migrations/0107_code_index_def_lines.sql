ALTER TABLE code_index_files
  ADD COLUMN def_start_lines integer[],
  ADD COLUMN def_end_lines integer[];
