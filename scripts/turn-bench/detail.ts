import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { createTestApp, LOCAL_HEADERS } from '../../apps/server/test/app-support.ts';
import type { TestDb } from '../../apps/server/test/support.ts';

export interface DetailRead {
  ms: number;
  bytes: number;
}

export interface DetailReader {
  read(conversationId: string): Promise<DetailRead>;
  close(): Promise<void>;
}

export async function startDetailReader(t: TestDb): Promise<DetailReader> {
  const server: Server = createServer(createTestApp(t));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    read(conversationId) {
      return new Promise<DetailRead>((resolve, reject) => {
        const started = performance.now();
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: `/api/conversations/${conversationId}`,
            headers: LOCAL_HEADERS,
          },
          (res) => {
            let bytes = 0;
            res.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
            });
            res.on('end', () => {
              if (res.statusCode !== 200) {
                reject(new Error(`Chat detail answered ${res.statusCode}.`));
                return;
              }
              resolve({ ms: performance.now() - started, bytes });
            });
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end();
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
