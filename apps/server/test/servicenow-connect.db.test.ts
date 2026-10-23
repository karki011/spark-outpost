import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SaveTicketConnectionRequest } from '@spark-outpost/contracts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import {
  changeSettings,
  connectedSources,
  removeConnection,
  saveConnection,
  ticketConnections,
} from '../src/tickets/connections.ts';
import { TicketApiError } from '../src/tickets/source.ts';
import {
  SERVICENOW_API_KEY,
  SERVICENOW_ME,
  SERVICENOW_PASSWORD,
  SERVICENOW_USER,
} from './fake-servicenow.ts';
import { createTestDb, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let secrets: SecretStore;
let stubs: TicketStubs;

const deps = () => ({ db: t.db, workspaceId: t.workspaceId, secrets, fetch });

function basic(password = SERVICENOW_PASSWORD): SaveTicketConnectionRequest {
  return {
    source: 'servicenow',
    instanceUrl: stubs.serviceNowUrl,
    authKind: 'basic',
    username: SERVICENOW_USER,
    password,
  };
}

async function serviceNow() {
  const { connections } = await ticketConnections(deps());
  return connections.find((entry) => entry.source === 'servicenow');
}

async function storedRow() {
  const { rows } = await t.db.query<Record<string, unknown>>(
    "SELECT * FROM ticket_connections WHERE workspace_id = $1 AND source = 'servicenow'",
    [t.workspaceId],
  );
  return rows[0];
}

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  stubs = await startTicketStubs();
});

afterEach(async () => {
  await stubs.close();
  await t.cleanup();
});

describe('connecting ServiceNow', () => {
  it('signs in with a password, probes each record type and keeps the secret in the keychain only', async () => {
    stubs.servicenow.denied.add('problem');
    await saveConnection(deps(), basic());
    const connection = await serviceNow();
    expect(connection).toMatchObject({
      account: 'Jordan Lee',
      siteUrl: stubs.serviceNowUrl,
      keySaved: true,
      atlassian: null,
      servicenow: {
        authKind: 'basic',
        login: SERVICENOW_USER,
        types: {
          incident: { on: true, reach: 'reachable' },
          request: { on: true, reach: 'reachable' },
          change: { on: true, reach: 'reachable' },
          problem: { on: false, reach: 'denied' },
        },
      },
    });
    expect(await secrets.get('ticket:servicenow')).toBe(SERVICENOW_PASSWORD);
    expect(JSON.stringify(await storedRow())).not.toContain(SERVICENOW_PASSWORD);
    expect(JSON.stringify(connection)).not.toContain(SERVICENOW_PASSWORD);
    expect((await storedRow())?.account_id).toBe(SERVICENOW_ME);
    expect(stubs.servicenow.calls).toContain(
      'GET /api/now/table/sys_user?sysparm_query=user_name%3Djordan.lee&sysparm_fields=sys_id%2Cuser_name%2Cname&sysparm_limit=1',
    );
  });

  it('signs in with an API key sent in its own header', async () => {
    await saveConnection(deps(), {
      source: 'servicenow',
      instanceUrl: stubs.serviceNowUrl,
      authKind: 'api_key',
      username: SERVICENOW_USER,
      apiKey: SERVICENOW_API_KEY,
    });
    expect((await serviceNow())?.servicenow?.authKind).toBe('api_key');
    expect(await secrets.get('ticket:servicenow')).toBe(SERVICENOW_API_KEY);
  });

  it('saves nothing when the sign-in is rejected or the user is unknown', async () => {
    const rejected = saveConnection(deps(), basic('wrong-password'));
    await expect(rejected).rejects.toThrow('ServiceNow rejected this sign-in (401)');
    await expect(rejected).rejects.toBeInstanceOf(TicketApiError);
    await expect(
      saveConnection(deps(), {
        source: 'servicenow',
        instanceUrl: stubs.serviceNowUrl,
        authKind: 'api_key',
        username: 'nobody',
        apiKey: SERVICENOW_API_KEY,
      }),
    ).rejects.toThrow('ServiceNow has no user named nobody that this sign-in can see.');
    expect(await serviceNow()).toBeUndefined();
    expect(await secrets.get('ticket:servicenow').catch(() => null)).toBeNull();
  });

  it('refuses an address that does not answer as ServiceNow', async () => {
    stubs.servicenow.foreign = true;
    await expect(saveConnection(deps(), basic())).rejects.toThrow(
      `${new URL(stubs.serviceNowUrl).host} didn't answer as ServiceNow. Check the instance address.`,
    );
    expect(await serviceNow()).toBeUndefined();
  });

  it('never follows a redirect, so the API key stays with the instance', async () => {
    const seen: (string | undefined)[] = [];
    const elsewhere = createServer((req, res) => {
      seen.push(req.headers['x-sn-apikey'] as string | undefined);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"result":[]}');
    });
    await new Promise<void>((resolve) => elsewhere.listen(0, '127.0.0.1', resolve));
    stubs.servicenow.redirectTo = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}`;
    try {
      await expect(
        saveConnection(deps(), {
          source: 'servicenow',
          instanceUrl: stubs.serviceNowUrl,
          authKind: 'api_key',
          username: SERVICENOW_USER,
          apiKey: SERVICENOW_API_KEY,
        }),
      ).rejects.toThrow('sent Spark to another address');
      expect(seen).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => elsewhere.close(() => resolve()));
    }
  });

  it('says when ServiceNow limits requests and saves nothing', async () => {
    stubs.servicenow.limited = 1;
    await expect(saveConnection(deps(), basic())).rejects.toThrow(
      'ServiceNow is limiting requests (429) while checking who you are. Nothing changed; try again in 30 seconds.',
    );
    expect(await serviceNow()).toBeUndefined();
  });

  it('turns a type on only when the account can read it', async () => {
    stubs.servicenow.denied.add('problem');
    await saveConnection(deps(), basic());
    await expect(
      changeSettings(deps(), 'servicenow', { serviceNowTypes: { problem: true } }),
    ).rejects.toThrow("This account can't read problems, so Problems stays off.");
    stubs.servicenow.denied.clear();
    await changeSettings(deps(), 'servicenow', {
      serviceNowTypes: { problem: true, change: false },
    });
    expect((await serviceNow())?.servicenow?.types).toMatchObject({
      problem: { on: true, reach: 'reachable' },
      change: { on: false, reach: 'reachable' },
    });
  });

  it('checks the connection again, turning off a type the account lost', async () => {
    await saveConnection(deps(), basic());
    stubs.servicenow.denied.add('change_request');
    stubs.servicenow.users[0]!.name = 'Jordan Q. Lee';
    await changeSettings(deps(), 'servicenow', { recheck: true });
    const connection = await serviceNow();
    expect(connection?.account).toBe('Jordan Q. Lee');
    expect(connection?.servicenow?.types.change).toEqual({ on: false, reach: 'denied' });
    expect(connection?.servicenow?.types.incident).toEqual({ on: true, reach: 'reachable' });
    await secrets.set('ticket:servicenow', 'changed-elsewhere');
    await expect(changeSettings(deps(), 'servicenow', { recheck: true })).rejects.toThrow(
      'ServiceNow rejected the saved sign-in (401). Disconnect it and connect again.',
    );
  });

  it('keeps record types and Check connection to ServiceNow, changing nothing else', async () => {
    await saveConnection(deps(), basic());
    await expect(
      changeSettings(deps(), 'linear', { recheck: true, moveOnShip: false }),
    ).rejects.toThrow('Record types and Check connection are for ServiceNow only.');
  });

  it('opens as a ticket source and disconnects by deleting the keychain item', async () => {
    await saveConnection(deps(), basic());
    expect((await connectedSources(deps())).map((open) => open.source.id)).toEqual(['servicenow']);
    await removeConnection(deps(), 'servicenow');
    expect(await serviceNow()).toBeUndefined();
    expect(await secrets.get('ticket:servicenow').catch(() => null)).toBeNull();
    const { rows } = await t.db.query<{ action: string; detail: Record<string, unknown> }>(
      "SELECT action, detail FROM ticket_events WHERE source = 'servicenow' ORDER BY at",
    );
    expect(rows.map((row) => row.action)).toEqual(['connect', 'disconnect']);
    expect(JSON.stringify(rows)).not.toContain(SERVICENOW_PASSWORD);
  });
});
