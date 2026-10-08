import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const entry = process.argv[2];
if (!entry) throw new Error('Pass the server entry file to start.');
if (process.send) {
  Object.defineProperty(process, 'parentPort', {
    value: {
      postMessage: (message: unknown) => process.send?.(message),
      on: (_event: 'message', listener: (event: { data: unknown }) => void) =>
        process.on('message', (data) => listener({ data })),
    },
  });
  process.on('disconnect', () => process.kill(process.pid, 'SIGTERM'));
}
delete process.env.ELECTRON_RUN_AS_NODE;
register();
await import(pathToFileURL(entry).href);
