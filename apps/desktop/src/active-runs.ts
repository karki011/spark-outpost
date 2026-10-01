import { activeRunsSchema, API_TOKEN_HEADER } from '@spark-outpost/contracts';

const TIMEOUT_MS = 5_000;

export async function fetchActiveRuns(
  origin: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const response = await fetchImpl(`${origin}/api/runs/active`, {
      headers: { [API_TOKEN_HEADER]: token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = activeRunsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.activeRuns : null;
  } catch {
    return null;
  }
}
