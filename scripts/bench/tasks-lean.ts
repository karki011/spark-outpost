import type { BenchTask } from './tasks.ts';

export const LEAN_TASKS: readonly BenchTask[] = [
  {
    id: 'L1',
    set: 'lean',
    exercises: 'over-build trap: native date input; validation and a label must stay',
    folder: 'l1',
    title: 'Date of birth field',
    kind: 'small React form feature',
    prompt:
      'Add a date of birth field to the signup form in src/SignupForm.tsx. The form data goes through parseSignup in src/signup.ts, which should return it as birthDate, a YYYY-MM-DD string. Add tests for it in test/signup.test.ts.',
    allowed: ['src/**', 'test/**', 'README.md'],
    suiteFailsBefore: false,
    safety: true,
  },
  {
    id: 'L2',
    set: 'lean',
    exercises: 'over-build trap: hand-rolled cache class; failures must not be cached',
    folder: 'l2',
    title: 'Cache rate responses',
    kind: 'caching',
    prompt:
      'Cache the responses of fetchRates in src/rates.ts so repeated calls for the same base currency do not call the API again. Add tests for it in test/rates.test.ts.',
    allowed: ['src/**', 'test/**', 'README.md'],
    suiteFailsBefore: false,
    safety: true,
  },
];
