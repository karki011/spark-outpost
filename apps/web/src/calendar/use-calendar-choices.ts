import { useState } from 'react';
import type {
  CalendarAccount,
  CalendarChoice,
  CalendarChoicePatch,
} from '@spark-outpost/contracts';
import { useCalendarActions } from './use-calendar.ts';

type Overrides = Readonly<Record<string, CalendarChoicePatch>>;

function withOverrides(
  accounts: readonly CalendarAccount[],
  overrides: Overrides,
): CalendarAccount[] {
  return accounts.map((account) => ({
    ...account,
    calendars: account.calendars.map(
      (calendar) => ({ ...calendar, ...overrides[calendar.key] }) as CalendarChoice,
    ),
  }));
}

export function useCalendarChoices(accounts: readonly CalendarAccount[]) {
  const { choose } = useCalendarActions();
  const [overrides, setOverrides] = useState<Overrides>({});
  const change = (key: string, patch: CalendarChoicePatch) => {
    setOverrides((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
    choose.mutate(
      { key, patch },
      {
        onSettled: () =>
          setOverrides((current) =>
            Object.fromEntries(Object.entries(current).filter(([saved]) => saved !== key)),
          ),
      },
    );
  };
  const shown = withOverrides(accounts, overrides);
  return {
    mac: shown.filter((account) => account.kind !== 'google'),
    google: shown.filter((account) => account.kind === 'google'),
    change,
    error: choose.error,
  };
}
