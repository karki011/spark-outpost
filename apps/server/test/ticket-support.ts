import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { atlassianHandler, fakeConfluence, type FakeConfluence } from './fake-confluence.ts';
import { fakeJira, type FakeJira } from './fake-jira.ts';
import { fakeLinear, type FakeLinear } from './fake-linear.ts';
import { fakeServiceNow, type FakeServiceNow } from './fake-servicenow.ts';

export interface TicketStubs {
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
): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
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
  const linearServer = await serve(linear.handle);
  const jiraServer = await serve(atlassianHandler(jira, confluence));
  const serviceNowServer = await serve(servicenow.handle);
  return {
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
