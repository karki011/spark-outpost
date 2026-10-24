import {
  approvalSchema,
  sparkRulesSchema,
  type Approval,
  type OutsideChangeAnswer,
  type SparkRuleAnswer,
  type SparkRules,
  type UpdateSparkRulesRequest,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const sparkRulesKey = ['spark-rules'] as const;

export const sparkRulesApi = {
  get: (): Promise<SparkRules> => request(sparkRulesSchema, '/spark-rules'),
  save: (update: UpdateSparkRulesRequest): Promise<SparkRules> =>
    request(sparkRulesSchema, '/spark-rules', { method: 'PUT', body: JSON.stringify(update) }),
  answerOutside: (answer: OutsideChangeAnswer): Promise<SparkRules> =>
    request(sparkRulesSchema, '/spark-rules/outside-change', {
      method: 'POST',
      body: JSON.stringify(answer),
    }),
  answer: (id: string, answer: SparkRuleAnswer): Promise<Approval> =>
    request(approvalSchema, `/approvals/${id}/spark-rule`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
};
