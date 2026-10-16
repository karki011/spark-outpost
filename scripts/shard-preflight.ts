export interface PreflightSteps {
  clearSlots(): Promise<boolean>;
  connectionShortage(): Promise<string | null>;
}

export type Preflight =
  { kind: 'blocked' } | { kind: 'short'; shortage: string } | { kind: 'ready' };

export async function preflight(steps: PreflightSteps): Promise<Preflight> {
  if (!(await steps.clearSlots())) return { kind: 'blocked' };
  const shortage = await steps.connectionShortage();
  return shortage ? { kind: 'short', shortage } : { kind: 'ready' };
}
