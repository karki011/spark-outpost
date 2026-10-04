ALTER TABLE runs DROP CONSTRAINT runs_role_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_role_check CHECK (
    role IN (
      'scout', 'architect', 'builder', 'critic', 'digest', 'coordinator', 'integrator', 'spark'
    )
  );
