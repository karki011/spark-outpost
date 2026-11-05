import {
  approvalSchema,
  sparkRulesSchema,
  type Approval,
  type GhAllowedRequest,
  type SetSparkRuleRequest,
  type OutsideChangeAnswer,
  type SparkRuleAnswer,
  type SparkRules,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const sparkRulesKey = ['spark-rules'] as const;

export const sparkRulesApi = {
  get: (): Promise<SparkRules> => request(sparkRulesSchema, '/spark-rules'),
  setRule: (change: SetSparkRuleRequest): Promise<SparkRules> =>
    request(sparkRulesSchema, '/spark-rules/rule', {
      method: 'PUT',
      body: JSON.stringify(change),
    }),
  setGhAllowed: (change: GhAllowedRequest): Promise<SparkRules> =>
    request(sparkRulesSchema, '/spark-rules/gh-allowed', {
      method: 'PUT',
      body: JSON.stringify(change),
    }),
  useRecommended: (): Promise<SparkRules> =>
    request(sparkRulesSchema, '/spark-rules/recommended', { method: 'POST' }),
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
