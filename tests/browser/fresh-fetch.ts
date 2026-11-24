import type { APIResponse, Route } from '@playwright/test';

export function fetchFresh(route: Route): Promise<APIResponse> {
  const headers = Object.fromEntries(
    Object.entries(route.request().headers()).filter(([name]) => name !== 'if-none-match'),
  );
  return route.fetch({ headers });
}
