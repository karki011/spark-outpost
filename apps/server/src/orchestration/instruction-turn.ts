import { publishRequested, withoutPublishAsks } from '../approvals/publish-policy.ts';
import type { CurrentTask } from './intake.ts';
import { BUILD_VERB } from './risk-rules.ts';

const INSTRUCTION_LIMIT = 200;

export function mainAgentInstruction(request: string, current: CurrentTask | null): boolean {
  const text = request.trim();
  if (!current || text.length === 0 || text.length > INSTRUCTION_LIMIT) return false;
  if (!publishRequested(text)) return false;
  return !BUILD_VERB.test(withoutPublishAsks(text));
}
