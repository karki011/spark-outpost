import {
  calloutKind,
  calloutTool,
  type CalloutKind,
  type CalloutTool,
} from '@spark-outpost/contracts';
import type { StepView } from '../run-projection.ts';

export interface Callout {
  tool: CalloutTool;
  kind: CalloutKind;
  target: string | null;
}

const FETCHED = /^Fetched (\S+)$/;

export function stepCallout(step: StepView, label: string): Callout | null {
  const tool = calloutTool(step.toolName, label);
  if (!tool) return null;
  const fetched = tool === 'WebFetch' ? (FETCHED.exec(label)?.[1] ?? null) : null;
  return { tool, kind: calloutKind(tool), target: step.target ?? fetched };
}
