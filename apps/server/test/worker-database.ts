import { afterAll, beforeAll } from 'vitest';
import { dropSpareSchemas, ensureWorkerDatabase } from './support.ts';

beforeAll(ensureWorkerDatabase);
afterAll(dropSpareSchemas);
