import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import {
  changeSettings,
  connectedSources,
  openSource,
  saveConnection,
  ticketConnections,
} from '../src/tickets/connections.ts';
import { productLive } from '../src/atlassian/session.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let secrets: SecretStore;
let stubs: TicketStubs;

const deps = () => ({ db: t.db, workspaceId: t.workspaceId, secrets, fetch });

const connect = (apiToken = JIRA_TOKEN) =>
  saveConnection(deps(), { source: 'jira', siteUrl: stubs.jiraUrl, email: JIRA_EMAIL, apiToken });

async function atlassian() {
  const { connections } = await ticketConnections(deps());
  return connections.find((entry) => entry.source === 'jira')!;
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

describe('connecting Atlassian', () => {
  it('finds Jira and Confluence on the site and turns both on', async () => {
    await connect();
    const connection = await atlassian();
    expect(connection).toMatchObject({
      account: JIRA_EMAIL,
      keySaved: true,
      atlassian: {
        jira: { reach: 'reachable', on: true },
        confluence: { reach: 'reachable', on: true },
      },
    });
    expect(await secrets.get('ticket:jira')).toBe(JIRA_TOKEN);
    expect(await productLive(deps(), 'confluence')).toBe(true);
    expect(JSON.stringify(connection)).not.toContain(JIRA_TOKEN);
  });

  it('says plainly when the token cannot reach Confluence and keeps it off', async () => {
    stubs.confluence.reachable = false;
    await connect();
    expect((await atlassian()).atlassian).toEqual({
      jira: { reach: 'reachable', on: true },
      confluence: { reach: 'denied', on: false },
    });
    await expect(changeSettings(deps(), 'jira', { confluenceOn: true })).rejects.toThrow(
      "This token can't reach Confluence on this site",
    );
    expect(await productLive(deps(), 'confluence')).toBe(false);
    expect(await openSource(deps(), 'jira')).not.toBeNull();
  });

  it('turns Confluence on once the token reaches it', async () => {
    stubs.confluence.reachable = false;
    await connect();
    stubs.confluence.reachable = true;
    await changeSettings(deps(), 'jira', { confluenceOn: true });
    expect((await atlassian()).atlassian?.confluence).toEqual({ reach: 'reachable', on: true });
  });

  it('takes Jira out of tickets and tools when its switch is off', async () => {
    await connect();
    await changeSettings(deps(), 'jira', { jiraOn: false });
    expect(await openSource(deps(), 'jira')).toBeNull();
    expect(await connectedSources(deps())).toEqual([]);
    expect(await productLive(deps(), 'jira')).toBe(false);
    expect(await productLive(deps(), 'confluence')).toBe(true);
    await changeSettings(deps(), 'jira', { jiraOn: true });
    expect(await openSource(deps(), 'jira')).not.toBeNull();
  });

  it('rejects a wrong token without saving it', async () => {
    await expect(connect('wrong_token_0123456789')).rejects.toThrow(
      'Atlassian rejected this token (401)',
    );
    expect(await secrets.get('ticket:jira').catch(() => null)).toBeNull();
    expect((await ticketConnections(deps())).connections).toEqual([]);
  });

  it('checks Confluence once for a connection made before Atlassian', async () => {
    await connect();
    await t.db.query(
      `UPDATE ticket_connections SET confluence_reach = NULL, confluence_on = false
       WHERE source = 'jira'`,
    );
    expect((await atlassian()).atlassian?.confluence).toEqual({ reach: 'unchecked', on: false });
    await eventually(async () => (await atlassian()).atlassian?.confluence.reach === 'reachable');
    stubs.confluence.reachable = false;
    expect((await atlassian()).atlassian?.confluence).toEqual({ reach: 'reachable', on: false });
  });
});
