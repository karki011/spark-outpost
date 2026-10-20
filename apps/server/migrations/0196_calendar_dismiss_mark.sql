ALTER TABLE calendar_marks
  DROP CONSTRAINT calendar_marks_kind_check,
  ADD CONSTRAINT calendar_marks_kind_check CHECK (kind IN ('remind_5', 'hold', 'dismiss'));
