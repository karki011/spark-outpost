ALTER TABLE run_advice DROP CONSTRAINT run_advice_purpose_check;
ALTER TABLE run_advice
  ADD CONSTRAINT run_advice_purpose_check
  CHECK (purpose IN ('intake', 'route', 'transition', 'parallel'));
