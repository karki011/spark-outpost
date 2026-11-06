import {
  CUSTOM_X_API_KEY_SUMMARY,
  type AdvisorConnection,
  type CustomKeyHeader,
} from '@spark-outpost/contracts';

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

export function keyHeaderOf(
  connection: Pick<AdvisorConnection, 'summary'> | null,
): CustomKeyHeader {
  return connection?.summary === CUSTOM_X_API_KEY_SUMMARY ? 'x-api-key' : 'bearer';
}
