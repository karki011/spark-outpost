import { createServer } from 'node:net';

export const LOOPBACK = '127.0.0.1';

export function freePort(host = LOOPBACK): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not read the port the system assigned.'));
      });
    });
  });
}
