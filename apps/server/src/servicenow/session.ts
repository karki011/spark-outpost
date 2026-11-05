import {
  getTicketConnection,
  type TicketConnectionRow,
} from '../persistence/ticket-connections.ts';
import { savedSecret, type TicketDeps } from '../tickets/connections.ts';
import { TicketNotConnectedError } from '../tickets/source.ts';
import { serviceNowAccessOf } from './connect.ts';
import { recordStore, type RecordStore } from './record-store.ts';

export interface ServiceNowSession {
  connection: TicketConnectionRow;
  instanceUrl: string;
  store: RecordStore;
}

const NOT_CONNECTED =
  "ServiceNow isn't connected, or every record type is off. Connect it in Settings → Connectors and turn on a record type.";

export async function openServiceNow(deps: TicketDeps): Promise<ServiceNowSession> {
  const connection = await getTicketConnection(deps.db, deps.workspaceId, 'servicenow');
  const secret = connection ? await savedSecret(deps, 'servicenow') : null;
  if (!connection || !secret) throw new TicketNotConnectedError(NOT_CONNECTED);
  const access = serviceNowAccessOf(connection, secret);
  const store = recordStore(access, connection, deps.fetch);
  if (store.tables.length === 0) throw new TicketNotConnectedError(NOT_CONNECTED);
  return { connection, instanceUrl: access.instanceUrl, store };
}
