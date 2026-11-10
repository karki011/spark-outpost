import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { atlassianHandler, fakeConfluence, type FakeConfluence } from './fake-confluence.ts';
import { fakeJira, type FakeJira } from './fake-jira.ts';
import { fakeLinear, type FakeLinear } from './fake-linear.ts';
import { fakeServiceNow, type FakeServiceNow } from './fake-servicenow.ts';

export interface Traffic {
  calls: number;
  fault: { status: number; retryAfter?: string } | null;
}

export interface TicketStubs {
  linearTraffic: Traffic;
  jiraTraffic: Traffic;
  linear: FakeLinear;
  jira: FakeJira;
  confluence: FakeConfluence;
  servicenow: FakeServiceNow;
  linearUrl: string;
  jiraUrl: string;
  serviceNowUrl: string;
  close(): Promise<void>;
}

async function serve(
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  traffic?: Traffic,
): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    if (traffic) traffic.calls += 1;
    if (traffic?.fault) {
      const { status, retryAfter } = traffic.fault;
      res.writeHead(status, retryAfter ? { 'retry-after': retryAfter } : {});
      res.end('{}');
      return;
    }
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

const stop = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

export async function startTicketStubs(): Promise<TicketStubs> {
  const linear = fakeLinear();
  const jira = fakeJira();
  const confluence = fakeConfluence();
  const servicenow = fakeServiceNow();
  const linearTraffic: Traffic = { calls: 0, fault: null };
  const jiraTraffic: Traffic = { calls: 0, fault: null };
  const linearServer = await serve(linear.handle, linearTraffic);
  const jiraServer = await serve(atlassianHandler(jira, confluence), jiraTraffic);
  const serviceNowServer = await serve(servicenow.handle);
  return {
    linearTraffic,
    jiraTraffic,
    linear,
    jira,
    confluence,
    servicenow,
    linearUrl: `${linearServer.url}/graphql`,
    jiraUrl: jiraServer.url,
    serviceNowUrl: serviceNowServer.url,
    close: async () => {
      await stop(linearServer.server);
      await stop(jiraServer.server);
      await stop(serviceNowServer.server);
    },
  };
}
