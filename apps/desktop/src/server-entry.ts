import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const entry = process.argv[2];
if (!entry) throw new Error('Pass the server entry file to start.');
register();
await import(pathToFileURL(entry).href);
