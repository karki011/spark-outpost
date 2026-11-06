import type { AdvisorConnection } from '@spark-outpost/contracts';

export interface EndpointFields {
  baseUrl: string;
  model: string;
  fastModel: string;
}

export function endpointFieldsOf(
  connection: Pick<AdvisorConnection, 'detail' | 'models'> | null,
): EndpointFields {
  if (!connection) return { baseUrl: '', model: '', fastModel: '' };
  const model = connection.models[0]?.label ?? '';
  const fast = connection.models[1]?.label ?? '';
  return { baseUrl: connection.detail, model, fastModel: fast === model ? '' : fast };
}
