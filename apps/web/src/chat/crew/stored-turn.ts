import { useState } from 'react';
import { isTerminalRunStatus, type Run } from '@spark-outpost/contracts';

export function useStoredTurn(run: Pick<Run, 'status'>): boolean {
  const [stored] = useState(() => isTerminalRunStatus(run.status));
  return stored;
}
