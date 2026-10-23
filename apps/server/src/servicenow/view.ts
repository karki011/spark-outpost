import {
  serviceNowTypeIdSchema,
  type ServiceNowConnection,
  type ServiceNowTypes,
} from '@spark-outpost/contracts';
import type { TicketConnectionRow } from '../persistence/ticket-connections.ts';
import { uncheckedTypes } from './connect.ts';

export function serviceNowView(row: TicketConnectionRow): ServiceNowConnection {
  const stored = row.serviceNowTypes ?? uncheckedTypes();
  const types = Object.fromEntries(
    serviceNowTypeIdSchema.options.map((type) => [
      type,
      { on: stored[type].on, reach: stored[type].reach ?? 'unchecked' },
    ]),
  ) as ServiceNowTypes;
  return { authKind: row.authKind ?? 'basic', login: row.login ?? '', types };
}
