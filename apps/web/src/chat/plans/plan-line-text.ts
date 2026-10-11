import { planSavedText, type PlanLine } from '@spark-outpost/contracts';

export function planLineText(line: Pick<PlanLine, 'items' | 'unit'>): string {
  return line.unit === 'pieces' ? planSavedText(line) : 'Plan saved';
}
