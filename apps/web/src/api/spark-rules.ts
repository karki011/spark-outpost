import {
  approvalSchema,
  sparkRulesSchema,
  type Approval,
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
  answer: (id: string, answer: SparkRuleAnswer): Promise<Approval> =>
    request(approvalSchema, `/approvals/${id}/spark-rule`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
};
