import { beforeAll } from 'vitest';
import { ensureWorkerDatabase } from './support.ts';

beforeAll(ensureWorkerDatabase);
