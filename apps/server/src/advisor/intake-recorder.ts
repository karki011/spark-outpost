import type { AdviceUsage, JevIntake } from '@spark-outpost/contracts';
import type { IntakeRequest } from './advice.ts';
import type { IntakeDeps } from './jev-types.ts';

export declare function askJev(
  deps: IntakeDeps,
  request: IntakeRequest,
  alias: string,
): Promise<
  | { status: 'failed' | 'timed_out'; error: string }
  | { status: 'answered'; intake: JevIntake; usage: AdviceUsage }
>;
